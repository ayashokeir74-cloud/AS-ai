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

res.header(
"Access-Control-Allow-Origin",
"*"
);

res.header(
"Access-Control-Allow-Methods",
"GET, POST, OPTIONS"
);

res.header(
"Access-Control-Allow-Headers",
"Content-Type"
);

if(req.method === "OPTIONS"){
return res.sendStatus(204);
}

next();
});

/* =========================
BODY
========================= */

app.use(
express.json({
limit:"20mb"
})
);

app.use(
express.static(__dirname)
);

/* =========================
GEMINI RETRY
========================= */

async function generateWithRetry(
contents,
config,
attempts=2
){

let lastError;

for(let i=0;i<attempts;i++){

try{

  return await ai.models.generateContent({

    model:
      "gemini-3.6-flash",

    contents,

    config

  });

}catch(error){

  lastError=error;

  const status=
    error?.status ||
    error?.code;

  console.log(
    `Gemini attempt ${i+1}/${attempts} failed:`,
    status
  );

  if(
    status !== 429 &&
    status !== 503
  ){

    throw error;

  }

  if(i < attempts-1){

    const waitTime=
      700 * Math.pow(2,i);

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          waitTime
        )
    );

  }

}

}

throw lastError;
}

/* =========================
CHAT
========================= */

app.post(
"/api/chat",
async(req,res)=>{

try{

  if(!process.env.GEMINI_API_KEY){

    return res.status(500).json({
      error:
        "GEMINI_API_KEY is not configured."
    });

  }

  const messages=
    Array.isArray(req.body.messages)
      ? req.body.messages
      : [];

  const image=
    req.body.image;

  const safeMessages=
    messages
      .filter(
        m =>
          m &&
          (
            m.role === "user" ||
            m.role === "assistant"
          ) &&
          typeof m.content === "string"
      )
      .slice(-24);

  let contents=
    safeMessages.map(
      m => ({

        role:
          m.role === "assistant"
            ? "model"
            : "user",

        parts:[
          {
            text:m.content
          }
        ]

      })
    );

  /* =========================
     IMAGE UNDERSTANDING
  ========================= */

  if(
    image &&
    typeof image === "string" &&
    image.startsWith("data:image/")
  ){

    const lastUserIndex=
      contents.length-1;

    if(lastUserIndex >= 0){

      const base64Data=
        image.split(",")[1];

      const match=
        image.match(
          /^data:(image\/[^;]+);base64,/
        );

      const mimeType=
        match?.[1] ||
        "image/png";

      contents[lastUserIndex]={

        role:"user",

        parts:[

          {
            text:
              safeMessages[
                lastUserIndex
              ]?.content ||
              "حلل هذه الصورة بدقة."
          },

          {
            inlineData:{
              mimeType,
              data:base64Data
            }
          }

        ]

      };

    }

  }

  /* =========================
     SYSTEM INSTRUCTION
  ========================= */

  const systemInstruction=`

You are A S AI, a highly capable and helpful AI assistant.

Your goals:

1. Understand the user's intent before answering.
2. Give accurate, useful and clear answers.
3. Reply in the same language as the user whenever possible.
4. If the user writes Arabic dialect, you may respond naturally in Arabic dialect when appropriate.
5. For difficult questions, explain the answer step by step.
6. Do not invent facts when you are uncertain.
7. If information is missing, clearly say what is missing.
8. When the user sends an image, carefully analyze the visible content.
9. For programming questions, provide practical and working solutions.
10. Keep answers organized and easy to read.
11. Remember the context of the current conversation.
12. Do not repeat the same information unnecessarily.
13. Be friendly, intelligent and concise unless the user asks for detail.
14. If the user asks for ideas, give creative and practical ideas.
15. If the user asks to compare things, clearly explain the important differences.
16. Always prioritize correctness over pretending to know something.

You are A S AI.
`;

  const response=
    await generateWithRetry(

      contents,

      {
        systemInstruction
      }

    );

  const reply=
    response?.text ||
    "لم يصلني رد من الذكاء الاصطناعي.";

  res.json({
    reply
  });

}catch(error){

  console.error(
    "GEMINI CHAT ERROR:",
    error
  );

  const status=
    error?.status ||
    error?.code;

  if(status === 429){

    return res.status(429).json({
      error:
        "وصلنا إلى الحد المؤقت للطلبات. جرّب بعد قليل."
    });

  }

  if(status === 503){

    return res.status(503).json({
      error:
        "Gemini مشغول حالياً. جرّب بعد لحظات."
    });

  }

  res.status(500).json({
    error:
      "حدث خطأ أثناء الاتصال بـ Gemini."
  });

}

}
);

/* =========================
IMAGE GENERATION
========================= */

app.post(
"/api/images",
async(req,res)=>{

try{

  if(!process.env.GEMINI_API_KEY){

    return res.status(500).json({
      error:
        "GEMINI_API_KEY is not configured."
    });

  }

  const prompt=
    typeof req.body.prompt === "string"
      ? req.body.prompt.trim()
      : "";

  if(!prompt){

    return res.status(400).json({
      error:
        "Image prompt is required."
    });

  }

  const response=
    await ai.models.generateContent({

      model:
        "gemini-2.0-flash-exp-image-generation",

      contents:prompt,

      config:{
        responseModalities:[
          "TEXT",
          "IMAGE"
        ]
      }

    });

  const parts=
    response
      ?.candidates?.[0]
      ?.content
      ?.parts || [];

  const imagePart=
    parts.find(
      part =>
        part?.inlineData
    );

  if(!imagePart){

    return res.status(500).json({
      error:
        "لم تصل الصورة من Gemini."
    });

  }

  const mimeType=
    imagePart.inlineData.mimeType ||
    "image/png";

  const imageBase64=
    imagePart.inlineData.data;

  /*
    نرجع Data URL مباشرة.
    الواجهة تعرضها كصورة حقيقية
    وتستطيع تحويلها إلى ملف للتحميل.
  */

  res.json({

    image:
      `data:${mimeType};base64,${imageBase64}`

  });

}catch(error){

  console.error(
    "GEMINI IMAGE ERROR:",
    error
  );

  const status=
    error?.status ||
    error?.code;

  if(status === 429){

    return res.status(429).json({
      error:
        "تم الوصول إلى الحد المؤقت لإنشاء الصور. جرّب بعد قليل."
    });

  }

  res.status(500).json({
    error:
      "حدث خطأ أثناء إنشاء الصورة."
  });

}

}
);

/* =========================
HEALTH CHECK
========================= */

app.get(
"/api/health",
(req,res)=>{

res.json({
  ok:true,
  service:"A S AI"
});

}
);

/* =========================
HOME
========================= */

app.get(
"/",
(req,res)=>{

res.sendFile(
  path.join(
    __dirname,
    "index.html"
  )
);

}
);

/* =========================
SERVER
========================= */

app.listen(
port,
()=>{

console.log(
  `A S AI running on port ${port}`
);

}
);
