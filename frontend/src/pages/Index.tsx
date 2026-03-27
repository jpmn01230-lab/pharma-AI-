import { useState, useRef, useCallback } from "react";
import { Upload, FileText, X, Send, Trash2, Bot, User, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import { callGroq, type GroqMessage } from "@/lib/groq";
import { callOllama } from "@/lib/ollama";
import { callRailway } from "@/lib/railway";
import { extractText } from "@/lib/extractText";
import { chunkText, getEmbedding, findRelevantChunks, type TextChunk } from "@/lib/embeddings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FileItem = {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  extractedText?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AppStatus = "awaiting" | "processing" | "ready";

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const ACCEPTED = ".pdf,.txt,.docx,.csv";

const SYSTEM_PROMPT = `You are a Senior Pharmaceutical Compliance Agent with deep expertise in GMP, FDA 21 CFR Part 211, ICH guidelines, and pharmaceutical manufacturing regulations.

Your responsibilities:
- Analyze Batch Manufacturing Records (BMR), Standard Operating Procedures (SOP), CAPA reports, and Audit Reports.
- Extract and summarize Critical Process Parameters (CPPs), Critical Quality Attributes (CQAs), and deviation events.
- For CAPAs: clearly distinguish Root Cause Analysis vs. Corrective Actions vs. Preventive Actions.
- For SOPs: provide numbered step-by-step guidance when asked procedural questions.
- Flag any values outside "Acceptable Range" defined in the document with ⚠️ DEVIATION ALERT.
- Always cite which document and section your answer is derived from.
- Do not fabricate data. If the answer is not in the provided documents, state: "This information is not present in the provided records."
- Maintain a professional, regulatory-focused, and precise tone at all times.`;

const Index = () => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [allChunks, setAllChunks] = useState<TextChunk[]>([]);
  const [status, setStatus] = useState<AppStatus>("awaiting");
  const [aiModel, setAiModel] = useState<string>("groq-primary");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: FileItem[] = Array.from(fileList).map((f) => ({
      id: generateUUID(),
      name: f.name,
      size: f.size,
      type: f.type,
      file: f,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
    setStatus("awaiting");
  }, []);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const detectDocType = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes("bmr") || lower.includes("batch")) return "BMR";
    if (lower.includes("capa")) return "CAPA";
    if (lower.includes("sop")) return "SOP";
    if (lower.includes("audit")) return "Audit Report";
    if (lower.includes("deviation")) return "Deviation Report";
    return "Document";
  };

  const processDocuments = async () => {
    if (files.length === 0) return;
    setStatus("processing");

    // Extract text from all uploaded files and embed chunks
    const updated: FileItem[] = [];
    const newChunks: TextChunk[] = [];
    
    for (const f of files) {
      try {
        const text = await extractText(f.file);
        updated.push({ ...f, extractedText: text });
        
        // Chunk and embed
        const chunks = chunkText(text);
        
        // Process in batches of 10 to speed up processing without overwhelming the API
        const BATCH_SIZE = 10;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
          const batch = chunks.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(async (chunk) => {
            try {
              const embedding = await getEmbedding(chunk);
              newChunks.push({
                text: chunk,
                embedding,
                sourceFile: detectDocType(f.name) + ": " + f.name,
              });
            } catch (embedErr) {
              console.error("Failed to generate embedding for chunk from", f.name, embedErr);
              // Non-fatal, just skips the chunk or continue
            }
          }));
        }
      } catch {
        updated.push({ ...f, extractedText: `[Could not extract text from ${f.name}]` });
      }
    }
    setFiles(updated);
    setAllChunks((prev) => [...prev, ...newChunks]);
    setStatus("ready");

    const docSummary = updated
      .map((f) => {
        const docType = detectDocType(f.name);
        const preview = f.extractedText
          ? f.extractedText.slice(0, 120).replace(/\n/g, " ") + "…"
          : "No preview available";
        return `- **${f.name}** — Classified as: \`${docType}\` (${formatSize(f.size)})\n  _Preview: ${preview}_`;
      })
      .join("\n");

    setMessages([
      {
        id: generateUUID(),
        role: "assistant",
        content: `### 📋 Document Intake & Extraction Complete\n\nI've extracted and indexed **${updated.length}** document${updated.length > 1 ? "s" : ""}:\n\n${docSummary}\n\n---\n\n**Ready for AI-powered compliance analysis.** You can now ask me:\n\n- _"Summarize the critical process parameters from the BMR."_\n- _"Were there any deviations flagged in the batch record?"_\n- _"What was the root cause and corrective action in the CAPA?"_\n- _"Walk me through SOP step 4.2."_`,
      },
    ]);

    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const clearConversation = () => {
    setMessages([]);
    setFiles([]);
    setAllChunks([]);
    setStatus("awaiting");
    setInput("");
  };

  const buildContext = async (query: string): Promise<string> => {
    if (allChunks.length === 0) return "[No context available]";
    
    try {
      const topChunks = await findRelevantChunks(query, allChunks, 3);
      return topChunks.map(c => `=== Source: ${c.sourceFile} ===\n${c.text}`).join("\n\n");
    } catch {
      return "[Failed to retrieve embeddings. Ensure your model provider is online.]";
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || status !== "ready" || isTyping) return;

    const userMsg: Message = {
      id: generateUUID(),
      role: "user",
      content: input.trim(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      // Find relevant chunks based on user query
      const docContext = await buildContext(userMsg.content);
      const systemWithDocs = `${SYSTEM_PROMPT}\n\n---\n\nYou have access to the following relevant document excerpts (found via bge-m3 semantics search):\n\n${docContext}`;

      const history: GroqMessage[] = [
        { role: "system", content: systemWithDocs },
        // Include last 6 messages for context (excluding the initial intake message)
        ...messages
          .filter((m) => m.id !== messages[0]?.id || messages.length > 1)
          .slice(-6)
          .map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })),
        { role: "user", content: userMsg.content },
      ];

      const isGroq = aiModel === "groq";
      const isRailway = aiModel === "railway";
      const ollamaModelConfig = aiModel.startsWith("ollama-") ? aiModel.replace("ollama-", "") : undefined;

      const assistantMsgId = generateUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: "assistant", content: (isGroq || isRailway) ? "..." : "" },
      ]);

      const onChunk = (text: string) => {
        setMessages((prev) => 
          prev.map((m) => m.id === assistantMsgId ? { ...m, content: text } : m)
        );
      };

      if (aiModel.startsWith("groq-")) {
        const isSecondary = aiModel.includes("-secondary");
        const modelName = isSecondary ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";
        const apiKey = isSecondary 
          ? import.meta.env.VITE_GROQ_API_KEY_NEW 
          : import.meta.env.VITE_GROQ_API_KEY;
          
        const reply = await callGroq(history, { apiKey, model: modelName });
        onChunk(reply);
      } else if (isRailway) {
        const reply = await callRailway(history);
        onChunk(reply);
      } else {
        await callOllama(history, ollamaModelConfig, onChunk);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: generateUUID(),
          role: "assistant",
          content: `⚠️ **Error communicating with AI:** ${err instanceof Error ? err.message : "Unknown error occurred."}`,
        },
      ]);
    } finally {
      setIsTyping(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div className="flex h-screen bg-secondary/40">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-border bg-background flex flex-col">
        <div className="p-5 border-b border-border flex items-center gap-3 bg-white">
          <div className="relative flex items-center justify-center w-10 h-10 shadow-[0_2px_10px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden rounded-md">
            {/* White background "page" */}
            <div className="absolute inset-0 bg-white" />
            {/* Exact Gear SVG Icon */}
            <svg viewBox="0 0 100 100" className="relative w-8 h-8">
              {/* Gear Outer Circle */}
              <circle cx="50" cy="50" r="32" className="fill-[#00E5FF]" />
              {/* Gear Teeth (12) */}
              {[...Array(12)].map((_, i) => (
                <rect
                  key={i}
                  x="44" y="10" width="12" height="15" rx="2"
                  className="fill-[#00E5FF]"
                  transform={`rotate(${i * 30} 50 50)`}
                />
              ))}
              {/* Inner Circle (Light Cyan) */}
              <circle cx="50" cy="50" r="22" className="fill-[#E0F7FA]" />
              {/* 3x3 Grid of Dots */}
              {[-1, 0, 1].map(row => 
                [-1, 0, 1].map(col => (
                  <circle 
                    key={`${row}-${col}`} 
                    cx={50 + col * 9} 
                    cy={50 + row * 9} 
                    r="2.5" 
                    className="fill-[#00E5FF]" 
                  />
                ))
              )}
            </svg>
          </div>
          <h1 className="font-display text-2xl tracking-normal mt-0.5">
            <span className="text-gray-900 font-medium">Metrics</span>
            <span className="text-[#00E5FF] font-medium">Numero</span>
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Upload Records
            </p>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors duration-200 cursor-pointer ${
                isDragging ? "border-primary bg-secondary" : "border-border bg-background hover:border-primary/40"
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-body font-medium text-foreground">Drag &amp; drop files</p>
              <p className="text-xs text-muted-foreground mt-1">BMR, SOP, CAPA, Audit Reports</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">PDF, TXT, DOCX, CSV • Max 200MB</p>
              <Button size="sm" className="mt-3">
                Browse files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={ACCEPTED}
                multiple
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">
                Queued ({files.length})
              </p>
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-md border border-border bg-background p-2.5">
                  <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-body font-medium text-foreground truncate">{f.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatSize(f.size)} · {detectDocType(f.name)}
                      {f.extractedText && <span className="text-green-500 ml-1">✓ indexed</span>}
                    </p>
                  </div>
                  <button onClick={() => removeFile(f.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border space-y-3">
          <Button
            className="w-full"
            disabled={files.length === 0 || status === "processing" || status === "ready"}
            onClick={processDocuments}
          >
            {status === "processing" ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Extracting &amp; Indexing…
              </span>
            ) : (
              "Process Documents"
            )}
          </Button>
          <Button variant="outline" className="w-full" onClick={clearConversation}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Session
          </Button>
          <div className="flex justify-center">
            <Badge
              variant={status === "ready" ? "default" : "outline"}
              className={
                status === "ready"
                  ? "bg-accent text-accent-foreground border-accent"
                  : status === "processing"
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground"
              }
            >
              {status === "awaiting" && "AWAITING RECORDS"}
              {status === "processing" && "EXTRACTING…"}
              {status === "ready" && "AI READY"}
            </Badge>
          </div>
        </div>
      </aside>

      {/* Main panel */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
          <div>
            <h2 className="font-display font-bold text-xl text-foreground">Pharmaceutical Compliance</h2>
            <p className="text-sm text-muted-foreground font-body">
              Ask questions about BMRs, SOPs, CAPAs &amp; Audit Reports
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Select value={aiModel} onValueChange={setAiModel}>
              <SelectTrigger className="w-[180px] h-8 text-xs bg-background">
                <SelectValue placeholder="AI Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groq-primary">Groq - Llama 3.3 (Old)</SelectItem>
                <SelectItem value="groq-secondary">Groq - Llama 3.3 (New)</SelectItem>
                <SelectItem value="railway">Railway - Llama 3.1</SelectItem>
                <SelectItem value="ollama-kimi-k2.5:cloud">kimi-k2.5</SelectItem>
                <SelectItem value="ollama-deepseek-v3.1:671b-cloud">deepseek-v3.1:671b</SelectItem>
                <SelectItem value="ollama-kimi-k2:1t-cloud">kimi-k2:1t</SelectItem>
                <SelectItem value="ollama-qwen3-coder:480b-cloud">qwen3-coder:480b</SelectItem>
                <SelectItem value="ollama-kimi-k2-thinking:cloud">kimi-k2-thinking</SelectItem>
                <SelectItem value="ollama-nemotron-3-nano:30b-cloud">nemotron-3-nano:30b</SelectItem>
                <SelectItem value="ollama-gpt-oss:120b-cloud">gpt-oss:120b</SelectItem>
                <SelectItem value="ollama-gemini-3-flash-preview:cloud">gemini-3-flash-preview</SelectItem>
                <SelectItem value="ollama-llama3.2">Ollama - Llama 3.2 (Local)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Deviation Alerts
              </Badge>
              <Badge variant="outline" className="text-xs border-accent/60 text-accent">
                <ShieldCheck className="w-3 h-3 mr-1" />
                GMP Compliant
              </Badge>
            </div>
          </div>
        </header>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl w-full">
                <StepCard step={1} title="Upload Records" description="Drop BMR, SOP, CAPA, or Audit PDFs into the sidebar." />
                <StepCard step={2} title="AI Extraction" description="Groq AI extracts and indexes all text from your documents." />
                <StepCard step={3} title="Ask Questions" description="Query compliance data, deviations, corrective actions & more." />
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-5">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                  <div
                    className={`rounded-lg px-4 py-3 max-w-[80%] text-sm font-body leading-relaxed ${
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm prose-slate max-w-none [&_blockquote]:border-l-primary/40 [&_blockquote]:text-muted-foreground [&_code]:text-primary [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <div className="rounded-lg px-4 py-3 bg-secondary text-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Analyzing documents…</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-border bg-background">
          <div className="max-w-3xl mx-auto flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder={
                status === "ready"
                  ? "Ask about deviations, CPPs, corrective actions…"
                  : "Upload and process pharmaceutical records first…"
              }
              disabled={status !== "ready" || isTyping}
              className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <Button onClick={sendMessage} disabled={status !== "ready" || !input.trim() || isTyping} size="icon">
              {isTyping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

const StepCard = ({ step, title, description }: { step: number; title: string; description: string }) => (
  <div className="rounded-lg border border-border bg-background p-6 text-center shadow-clinical">
    <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-display font-bold flex items-center justify-center mx-auto mb-3">
      {step}
    </div>
    <h3 className="font-display font-semibold text-foreground mb-1">{title}</h3>
    <p className="text-xs text-muted-foreground font-body">{description}</p>
  </div>
);

export default Index;
