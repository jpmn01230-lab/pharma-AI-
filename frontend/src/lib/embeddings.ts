export type TextChunk = {
  text: string;
  embedding: number[];
  sourceFile: string;
};

const HF_TOKEN = import.meta.env.VITE_HF_TOKEN || "";
const HF_URL = "https://api-inference.huggingface.co/models/BAAI/bge-large-en-v1.5";

export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HF_TOKEN}`
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.statusText}`);
    }

    const data = await response.json();

    // Hugging face feature-extraction typically returns a nested array for batches or sequence details
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0] as number[];
    }
    return data as number[];
  } catch (err) {
    console.error("Failed to generate embedding:", err);
    throw err;
  }
}

export function chunkText(text: string, chunkSize: number = 800, overlap: number = 100): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(" "));
    i += chunkSize - overlap;
  }

  return chunks;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function findRelevantChunks(query: string, allChunks: TextChunk[], topK: number = 5): Promise<TextChunk[]> {
  if (allChunks.length === 0) return [];

  // Get embedding for the user's query
  const queryEmbedding = await getEmbedding(query);

  // Calculate similarity for all stored chunks
  const scoredChunks = allChunks.map(chunk => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  // Sort descending by score
  scoredChunks.sort((a, b) => b.score - a.score);

  // Return top K chunks
  return scoredChunks.slice(0, topK).map(sc => sc.chunk);
}
