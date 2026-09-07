const express = require("express");
const OpenAI = require("openai");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

/* =========================
   AI CHAT + IMAGE UNDERSTANDING
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

    const safeMessages = messages
      .filter(m =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
      )
      .slice(-20);

    const image = req.body.image;

    let input = safeMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    /* إذا المستخدم رفع صورة */
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
              text: safeMessages[lastUserIndex].content
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
        "Answer clearly, accurately and naturally. " +
        "Reply in the language used by the user. " +
        "When the user sends an image, analyze it carefully and explain what you can see.",

      input: input
    });

    res.json({
      reply:
        response.output_text ||
        "لم يصلني نص من الذكاء الاصطناعي."
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

    if (prompt.length > 2000) {
      return res.status(400).json({
        error: "The image description is too long."
      });
    }

    const result = await client.images.generate({
      model: "gpt-image-2",
      prompt: prompt,
      size: "1024x1024"
    });

    const imageBase64 = result?.data?.[0]?.b64_json;

    if (!imageBase64) {
      return res.status(500).json({
        error: "لم تصل الصورة من نموذج الصور."
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
