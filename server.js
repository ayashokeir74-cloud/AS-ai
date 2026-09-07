const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const port = process.env.PORT || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/* =========================
   CORS
========================= */

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));


/* =========================
   CHAT + IMAGE UNDERSTANDING
========================= */

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured."
      });
    }

    const messages = Array.isArray(req.body.messages)
      ? req.body.messages
      : [];

    const image = req.body.image;

    const safeMessages = messages
      .filter(
        m =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .slice(-20);

    let contents = safeMessages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: m.content
        }
      ]
    }));

    /* =========================
       IMAGE UPLOAD
    ========================= */

    if (
      image &&
      typeof image === "string" &&
      image.startsWith("data:image/")
    ) {
      const lastUserIndex = contents.length - 1;

      if (lastUserIndex >= 0) {
        const base64Data = image.split(",")[1];

        const match = image.match(
          /^data:(image\/[^;]+);base64,/
        );

        const mimeType =
          match?.[1] || "image/png";

        contents[lastUserIndex] = {
          role: "user",
          parts: [
            {
              text:
                safeMessages[lastUserIndex]?.content ||
                "حلل هذه الصورة."
            },
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            }
          ]
        };
      }
    }


    /* =========================
       GEMINI CHAT
    ========================= */

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",

      contents,

      config: {
        systemInstruction:
          "You are A S AI, a helpful general-purpose AI assistant. " +
          "Answer clearly, accurately and naturally. " +
          "Reply in the same language used by the user. " +
          "When the user sends an image, analyze it carefully."
      }
    });


    res.json({
      reply:
        response.text ||
        "لم يصلني رد من الذكاء الاصطناعي."
    });

  } catch (error) {
    console.error(
      "GEMINI CHAT ERROR:",
      error
    );

    res.status(500).json({
      error:
        "حدث خطأ أثناء الاتصال بـ Gemini."
    });
  }
});


/* =========================
   IMAGE GENERATION
========================= */

app.post("/api/images", async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured."
      });
    }

    const prompt =
      typeof req.body.prompt === "string"
        ? req.body.prompt.trim()
        : "";

    if (!prompt) {
      return res.status(400).json({
        error: "Image prompt is required."
      });
    }


    const response = await ai.models.generateContent({
      model:
        "gemini-2.0-flash-exp-image-generation",

      contents: prompt,

      config: {
        responseModalities: [
          "TEXT",
          "IMAGE"
        ]
      }
    });


    const parts =
      response?.candidates?.[0]?.content?.parts ||
      [];

    const imagePart = parts.find(
      part => part.inlineData
    );


    if (!imagePart) {
      return res.status(500).json({
        error:
          "لم تصل الصورة من Gemini."
      });
    }


    const mimeType =
      imagePart.inlineData.mimeType ||
      "image/png";

    const imageBase64 =
      imagePart.inlineData.data;


    res.json({
      image_url:
        `data:${mimeType};base64,${imageBase64}`
    });

  } catch (error) {
    console.error(
      "GEMINI IMAGE ERROR:",
      error
    );

    res.status(500).json({
      error:
        "حدث خطأ أثناء إنشاء الصورة."
    });
  }
});


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});


/* =========================
   SERVER
========================= */

app.listen(port, () => {
  console.log(
    `A S AI running on port ${port}`
  );
});
