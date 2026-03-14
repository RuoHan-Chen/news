import { NextResponse } from "next/server";
import { normalizeIngestBody } from "@/lib/services/reportIngest";
import { generateStoryFromIncidents } from "@/lib/services/storyGenerateIncidents";
import { generateStoryFromReports } from "@/lib/services/storyGenerate";
import { runSosAuthorityNotify } from "@/lib/services/storySos";
import { saveRecommendationBrief } from "@/lib/storage/briefStore";
import type { MeshReport, NewsStory } from "@/lib/types";
import type { MapIncidentEvent, MapIncidentSos } from "@/lib/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Primary body (incidents):
 * - news_id (UUID) — story id + GET /api/recommendations/[news_id]
 * - sos: { title, description, latitude, longitude } — one SMS, one primary pin
 * - events: [{ title, description, latitude, longitude }, ...] — map pins only
 * - send_sos_sms?: boolean — Twilio to SOS_AUTHORITY_SMS_TO
 * - authoritySmsTo?: string
 *
 * Legacy: reports[] / report{} still supported for old clients.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      news_id?: string;
      sos?: MapIncidentSos;
      events?: MapIncidentEvent[];
      send_sos_sms?: boolean;
      authoritySmsTo?: string;
      reports?: MeshReport[];
      report?: Record<string, unknown>;
      existingStories?: NewsStory[];
    };

    const existing = body.existingStories || [];

    if (body.news_id && body.sos) {
      if (!UUID_RE.test(body.news_id.trim())) {
        return NextResponse.json(
          { ok: false, error: "news_id must be a UUID" },
          { status: 400 }
        );
      }
      const sos: MapIncidentSos = {
        title: String(body.sos.title || "SOS"),
        description: String(body.sos.description || ""),
        latitude: Number(body.sos.latitude),
        longitude: Number(body.sos.longitude),
      };
      if (
        Number.isNaN(sos.latitude) ||
        Number.isNaN(sos.longitude)
      ) {
        return NextResponse.json(
          { ok: false, error: "sos.latitude and sos.longitude required" },
          { status: 400 }
        );
      }
      const events: MapIncidentEvent[] = (body.events || []).map((e) => ({
        title: String(e.title || "Event"),
        description: String(e.description || ""),
        latitude: Number(e.latitude),
        longitude: Number(e.longitude),
      })).filter((e) => !Number.isNaN(e.latitude) && !Number.isNaN(e.longitude));

      const result = await generateStoryFromIncidents({
        newsId: body.news_id.trim(),
        sos,
        events,
      });

      if (!result.story) {
        return NextResponse.json({ ok: false, error: "No story" }, { status: 500 });
      }

      const nearbyForSms = events.map((e) => ({
        latitude: e.latitude,
        longitude: e.longitude,
        name: e.title,
        description: e.description,
      }));

      let authoritySms:
        | { sent: boolean; sid?: string; error?: string; body?: string }
        | undefined;

      if (body.send_sos_sms === true) {
        const primary: MeshReport = normalizeIngestBody({
          id: `sos-${body.news_id}`,
          sourcePeerId: "sos",
          latitude: sos.latitude,
          longitude: sos.longitude,
          placeName: sos.title,
          eventType: "sos",
          description: `${sos.title} — ${sos.description}`,
          timestamp: new Date().toISOString(),
          imageUrls: [],
          trustScore: 1,
          isSos: true,
        });
        authoritySms = await runSosAuthorityNotify({
          primary,
          nearbyEvents: nearbyForSms,
          authoritySmsTo: body.authoritySmsTo,
        });
      }

      const brief = {
        id: result.story.newsId!,
        basedOnStoryIds: [result.story.newsId!],
        basedOnExternalSources: [] as string[],
        generatedAt: new Date().toISOString(),
        actionableRecommendations: result.story.actionables!,
        avoidRecommendations: result.story.dontDos!,
        rationale: result.story.summary,
        area: `${sos.latitude.toFixed(3)},${sos.longitude.toFixed(3)}`,
        confidence: "medium" as const,
      };
      await saveRecommendationBrief(brief);

      return NextResponse.json({
        ok: true,
        ...result,
        news_id: result.story.newsId,
        recommendations_url: `/api/recommendations/${result.story.newsId}`,
        ...(authoritySms && { authoritySms }),
      });
    }

    /* Legacy reports[] */
    let reports: MeshReport[] = body.reports || [];
    if (body.report && !reports.length) {
      reports = [normalizeIngestBody(body.report)];
    }
    if (!reports.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Provide news_id + sos + events[], or reports[] / report{}. Mesh journal removed.",
        },
        { status: 400 }
      );
    }

    const result = await generateStoryFromReports(reports, existing);
    let authoritySms:
      | { sent: boolean; sid?: string; error?: string; body?: string }
      | undefined;
    const runSos = body.send_sos_sms === true || reports[0].isSos === true;
    if (runSos) {
      authoritySms = await runSosAuthorityNotify({
        primary: reports[0],
        nearbyEvents: [],
        authoritySmsTo: body.authoritySmsTo,
      });
    }
    return NextResponse.json({
      ok: true,
      ...result,
      ...(authoritySms && { authoritySms }),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 }
    );
  }
}
