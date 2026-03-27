import type { GroqMessage } from "./groq";

const RAILWAY_API_KEY = import.meta.env.VITE_RAILWAY_API_KEY;
const RAILWAY_URL = import.meta.env.VITE_RAILWAY_URL;

export async function callRailway(messages: GroqMessage[]): Promise<string> {
  if (!RAILWAY_URL || !RAILWAY_API_KEY) {
    throw new Error("Railway API URL or Key not configured");
  }

  const response = await fetch(RAILWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RAILWAY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-70b", // Assuming this is the model hosted on Railway based on user request "Llama 3.1"
      messages,
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Railway API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "No response received.";
}
