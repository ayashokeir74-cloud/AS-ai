const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   GEMINI
========================= */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

/* =========================
   MODELS
========================= */

const CHAT_MODEL = "gemini-3.6-flash";
const CHAT_FALLBACK_MODEL = "gemini-3.1-flash-lite";

const IMAGE_MODEL = "gemini-3.1-flash-image";

/* =========================
   SYSTEM
========================= */

const SYSTEM_INSTRUCTION = `
You are A S AI, a powerful modern general-purpose AI assistant.

Rules:
- Answer accurately and clearly.
- Reply in the same language as the user.
- Understand Arabic and Lebanese Arabic naturally.
- Help with studying, coding, technology, gaming and general questions.
- When an image is provided, analyze it carefully.
- Be concise when the user asks a simple question.
- Give detailed explanations when the user asks for details.
- Never reveal API keys, secrets or private server configuration.
- Do not unnecessarily repeat the user's question.
`;

/* =========================
   BODY LIMIT
========================= */

app.use(
  express.json({
    limit: "30mb"
  })
);

/* =========================
   CORS
========================= */

app.use((req, res, next) => {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* =========================
   STATIC FILES
========================= */

app.use(express.static(__dirname));

/* =========================
   HELPERS
========================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStatus(error) {
  return Number(
    error?.status ||
    error?.code ||
    error?.response?.status ||
    error?.response?.statusCode ||
    0
  );
}

function getErrorText(error) {
  if (!error) return "";

  if (typeof error === "string") {
    return error;
  }

  return String(
    error?.message ||
    error?.error?.message ||
    error
  );
}

function isRetryable(status) {
  return (
    status === 429 ||
    status === 500 ||
    status === 503
  );
}

async function retryRequest(fn, attempts = 3) {
  let lastError;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const status = getStatus(error);

      console.error(
        `Gemini attempt ${i + 1}/${attempts}`,
        status,
        getErrorText(error)
      );

      if (!isRetryable(status)) {
        throw error;
      }

      if (i < attempts - 1) {
        await sleep(1200 * (i + 1));
      }
    }
  }

  throw lastError;
}

/* =========================
   MESSAGE CLEANING
========================= */

function cleanMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(message => {
      return (
        message &&
        (message.role === "user" ||
          message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      );
    })
    .slice(-20);
}

/* =========================
   IMAGE PARSER
========================= */

function parseDataImage(dataUrl) {
  if (
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/") ||
    !dataUrl.includes("base64,")
  ) {
    return null;
  }

  const comma = dataUrl.indexOf(",");

  if (comma === -1) {
    return null;
  }

  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);

  const match = header.match(
    /^data:(image\/[^;]+);base64$/
  );

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    data
  };
}

/* =========================
   IMAGE EXTRACTION
========================= */

function extractGeneratedImage(response) {
  const parts =
    response?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    if (
      part?.inlineData?.data
    ) {
      const mimeType =
        part.inlineData.mimeType ||
        part.inlineData.mime_type ||
        "image/png";

      return {
        mimeType,
        data: part.inlineData.data,
        dataUrl:
          `data:${mimeType};base64,${part.inlineData.data}`
      };
    }
  }

  return null;
}

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "A S AI",
    geminiConfigured: Boolean(GEMINI_API_KEY),
    chatModel: CHAT_MODEL,
    fallbackModel: CHAT_FALLBACK_MODEL,
    imageModel: IMAGE_MODEL,
    time: new Date().toISOString()
  });
});

/* =========================
   CHAT REQUEST
========================= */

function buildChatContents(messages, image) {
  const contents = [];

  for (const message of messages) {
    contents.push({
      role:
        message.role === "assistant"
          ? "model"
          : "user",

      parts: [
        {
          text: message.content
        }
      ]
    });
  }

  const parsedImage =
    parseDataImage(image);

  if (parsedImage) {
    let lastUser = -1;

    for (
      let i = contents.length - 1;
      i >= 0;
      i--
    ) {
      if (
        contents[i].role === "user"
      ) {
        lastUser = i;
        break;
      }
    }

    if (lastUser !== -1) {
      contents[lastUser].parts.push({
        inlineData: {
          mimeType:
            parsedImage.mimeType,

          data:
            parsedImage.data
        }
      });
    }
  }

  return contents;
}

/* =========================
   CHAT
========================= */

app.post("/api/chat", async (req, res) => {
  let headersSent = false;

  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error:
          "GEMINI_API_KEY غير موجود في Render."
      });
    }

    const messages =
      cleanMessages(
        req.body?.messages
      );

    const image =
      req.body?.image || null;

    if (!messages.length) {
      return res.status(400).json({
        error:
          "لم يتم إرسال رسالة."
      });
    }

    const contents =
      buildChatContents(
        messages,
        image
      );

    /* =========================
       SSE
    ========================= */

    res.status(200);

    res.setHeader(
      "Content-Type",
      "text/event-stream; charset=utf-8"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-transform"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.setHeader(
      "X-Accel-Buffering",
      "no"
    );

    res.flushHeaders?.();

    headersSent = true;

    let stream;

    /* =========================
       PRIMARY MODEL
    ========================= */

    try {
      stream =
        await retryRequest(
          () =>
            ai.models.generateContentStream(
              {
                model: CHAT_MODEL,

                contents,

                config: {
                  systemInstruction:
                    SYSTEM_INSTRUCTION,

                  temperature: 0.7
                }
              }
            ),
          2
        );

    } catch (primaryError) {

      const status =
        getStatus(primaryError);

      console.error(
        "PRIMARY CHAT MODEL ERROR:",
        status,
        getErrorText(primaryError)
      );

      /*
        إذا الموديل الأساسي رفض الطلب
        نجرب موديل احتياطي.
      */

      if (
        status === 400 ||
        status === 404
      ) {

        stream =
          await retryRequest(
            () =>
              ai.models.generateContentStream(
                {
                  model:
                    CHAT_FALLBACK_MODEL,

                  contents,

                  config: {
                    systemInstruction:
                      SYSTEM_INSTRUCTION,

                    temperature: 0.7
                  }
                }
              ),
            2
          );

      } else {
        throw primaryError;
      }
    }

    /* =========================
       READ STREAM
    ========================= */

    let fullText = "";

    for await (const chunk of stream) {

      if (!chunk) {
        continue;
      }

      let text = "";

      try {
        if (
          typeof chunk.text === "string"
        ) {
          text = chunk.text;
        }
      } catch {}

      if (!text) {
        continue;
      }

      fullText += text;

      res.write(
        `data: ${JSON.stringify({
          type: "text",
          text
        })}\n\n`
      );
    }

    /* =========================
       EMPTY RESPONSE
    ========================= */

    if (!fullText.trim()) {

      fullText =
        "ما وصلني رد من Gemini. جرّب السؤال مرة ثانية.";

      res.write(
        `data: ${JSON.stringify({
          type: "text",
          text: fullText
        })}\n\n`
      );
    }

    /* =========================
       DONE
    ========================= */

    res.write(
      `data: ${JSON.stringify({
        type: "done",
        text: fullText
      })}\n\n`
    );

    res.end();

  } catch (error) {

    console.error(
      "================ CHAT ERROR ================"
    );

    console.error(
      getStatus(error)
    );

    console.error(
      getErrorText(error)
    );

    console.error(
      "============================================"
    );

    const status =
      getStatus(error);

    let message =
      "حدث خطأ أثناء الاتصال بـ Gemini.";

    if (status === 400) {
      message =
        "Gemini رفض الطلب. تأكد من الرسالة أو الصورة ثم جرّب مرة ثانية.";
    }

    else if (status === 401) {
      message =
        "مفتاح Gemini API غير صالح أو غير مقبول.";
    }

    else if (status === 403) {
      message =
        "مفتاح Gemini API لا يملك صلاحية استخدام الخدمة.";
    }

    else if (status === 404) {
      message =
        "موديل Gemini المطلوب غير متوفر حاليًا.";
    }

    else if (status === 429) {
      message =
        "وصلت للحد المؤقت لطلبات Gemini. انتظر قليلًا ثم جرّب.";
    }

    else if (status === 500) {
      message =
        "حصل خطأ داخلي في خدمة Gemini. جرّب مرة ثانية.";
    }

    else if (status === 503) {
      message =
        "Gemini تحت ضغط حاليًا. جرّب بعد قليل.";
    }

    if (headersSent) {

      try {
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error: message
          })}\n\n`
        );

        res.end();

      } catch {}
    }

    else {

      res.status(
        status >= 400 &&
        status < 600
          ? status
          : 500
      ).json({
        error: message
      });
    }
  }
});

/* =========================
   IMAGE GENERATION
========================= */

app.post("/api/images", async (req, res) => {

  try {

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error:
          "GEMINI_API_KEY غير موجود في Render."
      });
    }

    const prompt =
      typeof req.body?.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    const image =
      typeof req.body?.image === "string"
        ? req.body.image
        : null;

    const allowedSizes = [
      "0.5K",
      "1K",
      "2K",
      "4K"
    ];

    const imageSize =
      allowedSizes.includes(
        req.body?.imageSize
      )
        ? req.body.imageSize
        : "1K";

    if (!prompt) {
      return res.status(400).json({
        error:
          "اكتب وصف الصورة أولًا."
      });
    }

    const contents = [];

    contents.push({
      text: prompt
    });

    /* =========================
       IMAGE EDITING
    ========================= */

    const parsedImage =
      parseDataImage(image);

    if (parsedImage) {

      contents.push({
        inlineData: {
          mimeType:
            parsedImage.mimeType,

          data:
            parsedImage.data
        }
      });

    }

    /* =========================
       GENERATE
    ========================= */

    const response =
      await retryRequest(
        () =>
          ai.models.generateContent({
            model: IMAGE_MODEL,

            contents,

            config: {
              responseModalities: [
                "TEXT",
                "IMAGE"
              ],

              responseFormat: {
                image: {
                  imageSize
                }
              }
            }
          }),
        2
      );

    /* =========================
       EXTRACT IMAGE
    ========================= */

    const generatedImage =
      extractGeneratedImage(
        response
      );

    if (!generatedImage) {

      console.error(
        "Gemini returned no image."
      );

      return res.status(500).json({
        error:
          "Gemini لم يرجع صورة. جرّب وصفًا مختلفًا."
      });
    }

    res.json({
      success: true,

      image:
        generatedImage.dataUrl,

      image_url:
        generatedImage.dataUrl,

      mimeType:
        generatedImage.mimeType,

      imageSize,

      edited:
        Boolean(parsedImage)
    });

  } catch (error) {

    console.error(
      "================ IMAGE ERROR ================"
    );

    console.error(
      getStatus(error)
    );

    console.error(
      getErrorText(error)
    );

    console.error(
      "============================================="
    );

    const status =
      getStatus(error);

    let message =
      "حدث خطأ أثناء إنشاء الصورة.";

    if (status === 400) {
      message =
        "Gemini رفض طلب الصورة. جرّب وصفًا مختلفًا.";
    }

    else if (status === 401) {
      message =
        "مفتاح Gemini API غير صالح.";
    }

    else if (status === 403) {
      message =
        "مفتاح Gemini API لا يملك صلاحية إنشاء الصور.";
    }

    else if (status === 404) {
      message =
        "موديل إنشاء الصور غير متوفر.";
    }

    else if (status === 429) {
      message =
        "وصلت للحد المؤقت لإنشاء الصور. انتظر قليلًا.";
    }

    else if (status === 503) {
      message =
        "خدمة الصور تحت ضغط حاليًا. جرّب بعد قليل.";
    }

    res.status(
      status >= 400 &&
      status < 600
        ? status
        : 500
    ).json({
      error: message
    });
  }
});

/* =========================
   ROOT
========================= */

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );

});

/* =========================
   START
========================= */

app.listen(PORT, () => {

  console.log(
    "================================"
  );

  console.log(
    `A S AI running on port ${PORT}`
  );

  console.log(
    `Chat model: ${CHAT_MODEL}`
  );

  console.log(
    `Fallback: ${CHAT_FALLBACK_MODEL}`
  );

  console.log(
    `Image model: ${IMAGE_MODEL}`
  );

  console.log(
    `API key configured: ${Boolean(
      GEMINI_API_KEY
    )}`
  );

  console.log(
    "================================"
  );

});
