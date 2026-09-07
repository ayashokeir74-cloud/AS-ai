const express = require("express");
const OpenAI = require("openai");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

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
      .filter(
        m =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .slice(-20);

    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      instructions:
        "You are A S AI, a helpful general-purpose AI assistant. Answer clearly and accurately.",
      input: safeMessages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    res.json({
      reply: response.output_text || "لم يصلني نص من النموذج."
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "حدث خطأ أثناء الاتصال بالذكاء الاصطناعي."
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`A S AI running on port ${port}`);
});
