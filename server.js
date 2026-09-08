const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.use(express.json({ limit: "25mb" }));

/* =========================
   CORS
========================= */

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.static(__dirname));

/* =========================
   CONFIG
========================= */

const CHAT_MODEL = "gemini-3.1-flash-lite";
const IMAGE_MODEL = "gemini-3.1-flash-image";

const SYSTEM_INSTRUCTION = `
You are A S AI, a modern general-purpose AI assistant.

Rules:
- Answer clearly and accurately.
- Reply in the same language as the user.
- Understand Arabic and Lebanese Arabic naturally.
- Be helpful with questions, studying, coding, technology and general topics.
- If the user sends an image, analyze it carefully.
- If the user asks to edit an image and an image is provided, the image endpoint will handle the editing.
- Never reveal API keys, secrets or server configuration.
- Do not unnecessarily repeat the user's question.
`;

/* =========================
   HELPERS
========================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorStatus(error) {
  return (
    error?.status ||
    error?.code ||
    error?.response?.status ||
    error?.response?.statusCode
  );
}

async function withRetry(fn, attempts = 3) {
  let lastError;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const status = getErrorStatus(error);

      console.error(
        `Gemini request failed ${i + 1}/${attempts}:`,
        status || error?.message || error
      );

      if (![429, 500, 503].includes(Number(status))) {
        throw error;
      }

      if (i < attempts - 1) {
        await sleep(1000 * (i + 1));
      }
    }
  }

  throw lastError;
}

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
        message.content.trim()
      );
    })
    .slice(-18);
}

function parseDataImage(dataUrl) {
  if (
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/") ||
    !dataUrl.includes("base64,")
  ) {
    return null;
  }

  const commaIndex = dataUrl.indexOf(",");

  if (commaIndex === -1) {
    return null;
  }

  const header = dataUrl.substring(0, commaIndex);
  const data = dataUrl.substring(commaIndex + 1);

  const match = header.match(
    /^data:(image\/[^;]+);base64$/
  );

  return {
    mimeType: match?.[1] || "image/jpeg",
    data
  };
}

function extractGeneratedImage(response) {
  const parts =
    response?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    if (
      part &&
      part.inlineData &&
      part.inlineData.data
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
   HEALTH
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "A S AI",
    chatModel: CHAT_MODEL,
    imageModel: IMAGE_MODEL,
    time: new Date().toISOString()
  });
});

/* =========================
   CHAT
========================= */

app.post("/api/chat", async (req, res) => {
  let streamStarted = false;

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY غير موجود في Render."
      });
    }

    const messages = cleanMessages(req.body.messages);
    const image = req.body.image;

    if (!messages.length) {
      return res.status(400).json({
        error: "لم يتم إرسال رسالة."
      });
    }

    /*
      تحويل المحادثة إلى محتوى Gemini
    */

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

    /*
      إضافة الصورة إلى آخر رسالة للمستخدم
    */

    const parsedImage =
      parseDataImage(image);

    if (parsedImage) {
      let lastUserIndex = -1;

      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role === "user") {
          lastUserIndex = i;
          break;
        }
      }

      if (lastUserIndex !== -1) {
        contents[lastUserIndex].parts.push({
          inlineData: {
            mimeType: parsedImage.mimeType,
            data: parsedImage.data
          }
        });
      }
    }

    /*
      SSE response
      الـHTML الحالي عندك يفهم هذه الصيغة
    */

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

    res.flushHeaders?.();

    streamStarted = true;

    /*
      نستخدم generateContentStream بدل Interactions
      حتى يكون متوافقًا بشكل مباشر مع واجهة A S AI.
    */

    const stream = await withRetry(
      () =>
        ai.models.generateContentStream({
          model: CHAT_MODEL,

          contents,

          config: {
            systemInstruction:
              SYSTEM_INSTRUCTION,

            temperature: 0.7
          }
        }),
      3
    );

    let fullText = "";

    for await (const chunk of stream) {
      if (!chunk) continue;

      const text =
        typeof chunk.text === "string"
          ? chunk.text
          : "";

      if (!text) continue;

      fullText += text;

      res.write(
        `data: ${JSON.stringify({
          type: "text",
          text
        })}\n\n`
      );
    }

    if (!fullText.trim()) {
      fullText =
        "لم يصلني رد من الذكاء الاصطناعي.";

      res.write(
        `data: ${JSON.stringify({
          type: "text",
          text: fullText
        })}\n\n`
      );
    }

    res.write(
      `data: ${JSON.stringify({
        type: "done",
        text: fullText
      })}\n\n`
    );

    res.end();

  } catch (error) {
    console.error(
      "CHAT ERROR:",
      error
    );

    const status =
      Number(getErrorStatus(error));

    let message =
      "حدث خطأ أثناء الاتصال بـ Gemini.";

    if (status === 429) {
      message =
        "وصلنا للحد المؤقت للطلبات. انتظر قليلًا ثم جرّب مرة ثانية.";
    } else if (status === 503) {
      message =
        "Gemini تحت ضغط حاليًا. جرّب مرة ثانية بعد قليل.";
    } else if (status === 400) {
      message =
        "Gemini رفض الطلب. جرّب رسالة أخرى.";
    } else if (
      error?.message &&
      process.env.NODE_ENV !== "production"
    ) {
      message = error.message;
    }

    if (streamStarted) {
      try {
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error: message
          })}\n\n`
        );

        res.end();
      } catch {}
    } else {
      res.status(status || 500).json({
        error: message
      });
    }
  }
});

/* =========================
   IMAGE GENERATION / EDITING
========================= */

app.post("/api/images", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY غير موجود في Render."
      });
    }

    const prompt =
      typeof req.body.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    const image =
      typeof req.body.image === "string"
        ? req.body.image
        : null;

    const imageSize =
      ["0.5K", "1K", "2K", "4K"].includes(
        req.body.imageSize
      )
        ? req.body.imageSize
        : "1K";

    if (!prompt) {
      return res.status(400).json({
        error: "اكتب وصف الصورة أولًا."
      });
    }

    const contents = [];

    contents.push({
      text: prompt
    });

    /*
      إذا في صورة:
      Gemini سيستخدمها كمدخل لتعديل الصورة.
    */

    const parsedImage =
      parseDataImage(image);

    if (parsedImage) {
      contents.push({
        inlineData: {
          mimeType: parsedImage.mimeType,
          data: parsedImage.data
        }
      });
    }

    const response =
      await withRetry(
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

    const generatedImage =
      extractGeneratedImage(response);

    if (!generatedImage) {
      return res.status(500).json({
        error:
          "Gemini لم يرجع صورة. جرّب وصفًا مختلفًا."
      });
    }

    res.json({
      success: true,

      image:
        generatedImage.dataUrl,

      mimeType:
        generatedImage.mimeType,

      imageSize,

      edited:
        Boolean(parsedImage)
    });

  } catch (error) {
    console.error(
      "IMAGE ERROR:",
      error
    );

    const status =
      Number(getErrorStatus(error));

    if (status === 429) {
      return res.status(429).json({
        error:
          "وصلنا للحد المؤقت لإنشاء الصور. انتظر قليلًا ثم جرّب."
      });
    }

    if (status === 503) {
      return res.status(503).json({
        error:
          "خدمة إنشاء الصور تحت ضغط حاليًا. جرّب بعد قليل."
      });
    }

    res.status(status || 500).json({
      error:
        error?.message ||
        "حدث خطأ أثناء إنشاء أو تعديل الصورة."
    });
  }
});

/* =========================
   MAIN PAGE
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log(
    `A S AI running on port ${PORT}`
  );

  console.log(
    `Chat model: ${CHAT_MODEL}`
  );

  console.log(
    `Image model: ${IMAGE_MODEL}`
  );
});
