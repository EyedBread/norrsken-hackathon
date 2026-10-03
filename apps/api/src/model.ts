import { GoogleGenAI, type Content, type FunctionCall, type FunctionDeclaration } from '@google/genai';

export type ModelRequest = {
  system: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  /** When set, the model must answer with JSON matching this schema. */
  jsonSchema?: unknown;
  signal: AbortSignal;
};

export type ModelTurn = {
  /** Raw model content, passed back unchanged so thought signatures survive. */
  content: Content | null;
  functionCalls: FunctionCall[];
  text: string;
};

/** The only thing the agent needs from Gemini. Tests swap in a scripted fake. */
export interface ResearchModel {
  readonly name: string;
  generate(req: ModelRequest): Promise<ModelTurn>;
}

export function createGeminiModel(apiKey: string, model: string): ResearchModel {
  const ai = new GoogleGenAI({ apiKey });
  return {
    name: model,
    async generate(req) {
      const res = await ai.models.generateContent({
        model,
        contents: req.contents,
        config: {
          systemInstruction: req.system,
          abortSignal: req.signal,
          ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
          ...(req.jsonSchema
            ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema }
            : {}),
        },
      });
      return {
        content: res.candidates?.[0]?.content ?? null,
        functionCalls: res.functionCalls ?? [],
        text: res.text ?? '',
      };
    },
  };
}
