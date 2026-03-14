import type { MeshReport, NewsStory, UrgencyLevel, AuthorityType } from "@/lib/types";
import type {
  ArticleDraft,
  EscalationDraftContent,
  LLMProvider,
  RecommendationDraft,
} from "@/lib/agents/types";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

async function chatJSON<T>(system: string, user: string): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { choices: [{ message: { content: string } }] };
  const text = data.choices[0]?.message?.content || "{}";
  return JSON.parse(text) as T;
}

export function createOpenAIProvider(): LLMProvider {
  return {
    async generateSosAuthoritySms(input: {
      latitude: number;
      longitude: number;
      mapsUrl: string;
      sosCategory: string;
      sosDescription: string;
      placeName: string;
      peerId: string;
      timestamp: string;
      nearbyIncidents: import("@/lib/agents/types").SosNearbyEvent[];
    }): Promise<{ smsBody: string }> {
      return chatJSON<{ smsBody: string }>(
        `Compose ONE SMS to police/emergency under 1500 chars. Include lat,lng, maps link, SOS type, user text, peer id, time. List nearby incidents (shooting, earthquake, etc.) as unverified mesh context. JSON: {"smsBody":"..."}`,
        JSON.stringify(input)
      );
    },

    async generateArticleFromIncidents(input: {
      newsId: string;
      sos: import("@/lib/types").MapIncidentSos;
      events: import("@/lib/types").MapIncidentEvent[];
    }): Promise<ArticleDraft> {
      const out = await chatJSON<{
        title: string;
        dek: string;
        summary: string;
        articleBody: string;
        canonicalTags: string[];
        severity: ArticleDraft["severity"];
        imageDescriptors: string[];
        actionables: [string, string, string];
        dontDos: [string, string, string];
      }>(
        `Crisis news from one SOS and multiple map events. JSON: title, dek, summary, articleBody (markdown), canonicalTags[], severity, imageDescriptors[] (can be []), actionables [3 strings], dontDos [3 strings].`,
        JSON.stringify(input)
      );
      return {
        ...out,
        imageDescriptors: out.imageDescriptors || [],
        unverifiedNote: "Unverified community submissions.",
        actionables: out.actionables,
        dontDos: out.dontDos,
      };
    },

    async generateArticle(reports: MeshReport[]): Promise<ArticleDraft> {
      const user = JSON.stringify(
        reports.map((r) => ({
          placeName: r.placeName,
          eventType: r.eventType,
          description: r.description,
          timestamp: r.timestamp,
          trustScore: r.trustScore,
          imageHints: r.imageDescriptors.length ? r.imageDescriptors : r.imageUrls,
        }))
      );
      const out = await chatJSON<{
        title: string;
        dek: string;
        summary: string;
        articleBody: string;
        canonicalTags: string[];
        severity: ArticleDraft["severity"];
        imageDescriptors: string[];
      }>(
        `You write factual, neutral local news from mesh crisis reports. Never claim verification. Mark uncertain details. JSON only: title, dek, summary, articleBody (markdown), canonicalTags[], severity (low|medium|high|critical), imageDescriptors[] (short captions from metadata; if only URLs say "image submitted").`,
        `Generate article from: ${user}`
      );
      return {
        ...out,
        unverifiedNote:
          "Sourced from community mesh reports; not independently verified.",
      };
    },

    async generateRecommendations(input: {
      stories: NewsStory[];
      areaLabel: string;
      mockExternal: boolean;
    }): Promise<RecommendationDraft> {
      const user = JSON.stringify({
        area: input.areaLabel,
        stories: input.stories.map((s) => ({
          title: s.title,
          summary: s.summary,
          severity: s.severity,
          tags: s.canonicalTags,
        })),
        mockExternal: input.mockExternal,
      });
      return chatJSON<RecommendationDraft>(
        `Return JSON: actionable [3 strings], avoid [3 strings], rationale, confidence (low|medium|high), externalSourceLabels [strings]. Actionable = safe routes, aid, communication. Avoid = rumors, dangerous zones. Tie to area.`,
        user
      );
    },

    async generateEscalation(input: {
      storySummary: string;
      eventType: string;
      urgency: UrgencyLevel;
      incidentLat: number;
      incidentLng: number;
      placeName: string;
      helpType: string;
    }): Promise<EscalationDraftContent> {
      const out = await chatJSON<{
        phoneScript: string;
        textMessage: string;
        authorityType: AuthorityType;
      }>(
        `Demo escalation drafts only — user understands not to replace 911. JSON: phoneScript (one paragraph), textMessage (SMS length), authorityType one of police|fire|ems|municipal|utilities.`,
        JSON.stringify(input)
      );
      return out;
    },
  };
}
