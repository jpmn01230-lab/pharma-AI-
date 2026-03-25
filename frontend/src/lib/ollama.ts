import type { GroqMessage } from "./groq";

const OLLAMA_API_KEY = import.meta.env.VITE_OLLAMA_API_KEY;
const OLLAMA_URL = "/ollama-api/api/chat";
// Default local generation model
const DEFAULT_MODEL = "llama3.2";

export async function callOllama(
  messages: GroqMessage[], 
  model: string = DEFAULT_MODEL,
  onChunk?: (text: string) => void
): Promise<string> {
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OLLAMA_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        stream: !!onChunk,
        options: {
          temperature: 0.3,
          num_predict: 1024,
        }
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
    }

    if (onChunk) {
      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              fullText += data.message.content;
              onChunk(fullText);
            }
          } catch (e) {
            console.error("Streaming JSON parse error:", e, line);
          }
        }
      }
      return fullText;
    } else {
      const data = await response.json();
      return data.message?.content ?? "No response received.";
    }
  } catch (err) {
    console.error("Failed to generate with Ollama:", err);
    throw err;
  }
}
