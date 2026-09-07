const express = require("express");
const OpenAI = require("openai");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* السماح لموقع GitHub Pages بالاتصال بالسيرفر */
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
   CHAT
========================= */

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not configured."
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

    let input = safeMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    /* إذا المستخدم أرسل صورة */
    if (
      image &&
      typeof image === "string" &&
      image.startsWith("data:image/")
    ) {
      const lastUserIndex = input.length - 1;

      if (lastUserIndex >= 0) {
        input[lastUserIndex] = {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                safeMessages[lastUserIndex].content ||
                "حلل هذه الصورة."
            },
            {
              type: "input_image",
              image_url: image
            }
          ]
        };
      }
    }

    const response = await client.responses.create({
      model: "gpt-5.6-luna",

      instructions:
        "You are A S AI, a helpful general-purpose AI assistant. " +
        "Answer clearly and naturally. " +
        "Reply in the same language used by the user. " +
        "If the user sends an image, analyze it carefully.",

      input
    });

    res.json({
      reply:
        response.output_text ||
        "لم يصلني رد من الذكاء الاصطناعي."
    });

  } catch (error) {
    console.error("CHAT ERROR:", error);

    res.status(500).json({
      error: "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي."
    });
  }
});


/* =========================
   IMAGE GENERATION
========================= */

app.post("/api/images", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not configured."
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

    const result = await client.images.generate({
      model: "gpt-image-2",
      prompt,
      size: "1024x1024"
    });

    const imageBase64 = result?.data?.[0]?.b64_json;

    if (!imageBase64) {
      return res.status(500).json({
        error: "لم تصل الصورة."
      });
    }

    res.json({
      image_url: `data:image/png;base64,${imageBase64}`
    });

  } catch (error) {
    console.error("IMAGE ERROR:", error);

    res.status(500).json({
      error: "حدث خطأ أثناء إنشاء الصورة."
    });
  }
});


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


/* =========================
   SERVER
========================= */

app.listen(port, () => {
  console.log(`A S AI running on port ${port}`);
});
