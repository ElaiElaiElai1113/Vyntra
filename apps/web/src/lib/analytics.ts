import { supabase } from "@/lib/supabase";

export type AnalyticsEventName =
  | "generate_clicked"
  | "generate_success"
  | "generate_failed"
  | "workflow_saved"
  | "simulation_run"
  | "live_run"
  | "template_used";

export async function trackEvent(eventName: AnalyticsEventName, properties: Record<string, unknown> = {}) {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user?.id) return;

    const { error } = await supabase.from("analytics_events").insert({
      user_id: userData.user.id,
      event_name: eventName,
      properties,
    });

    if (error) {
      console.warn("Failed to track analytics event", eventName, error.message);
    }
  } catch (err) {
    console.warn("Unexpected analytics tracking error", eventName, err);
  }
}
