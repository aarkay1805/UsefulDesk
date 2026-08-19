import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  interpolateColors,
  useCurrentFrame,
} from "remotion";
import { Avatar, Brand, CheckIcon, SceneBackground } from "../components";

export const FollowUpScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0d14", overflow: "hidden" }}>
      <SceneBackground />
      <div
        style={{
          position: "absolute",
          inset: "70px 80px",
          display: "flex",
          flexDirection: "column",
          gap: 44,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Brand compact />
          <div style={{ fontSize: 22, color: "#8f8b9c", fontWeight: 600 }}>
            Owner view · Today
          </div>
        </div>
        <Interactive.Div
          name="Ownership headline"
          style={{
            color: "#ffffff",
            fontSize: 72,
            lineHeight: 1.02,
            fontWeight: 780,
            letterSpacing: "-0.055em",
            maxWidth: 860,
            opacity: interpolate(frame, [0, 18], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Every exception gets an owner.
        </Interactive.Div>
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 22,
          }}
        >
          <Interactive.Div
            name="Follow-up assignment card"
            style={{
              borderRadius: 30,
              padding: 30,
              border: "1px solid rgba(255,255,255,0.10)",
              backgroundColor: "rgba(25,25,35,0.94)",
              opacity: interpolate(frame, [12, 30], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(
                frame,
                [12, 30],
                ["-34px 0px", "0px 0px"],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                },
              ),
            }}
          >
            <div style={{ fontSize: 21, color: "#8f8b9c", fontWeight: 600 }}>
              Follow-up
            </div>
            <div
              style={{
                fontSize: 32,
                lineHeight: 1.18,
                color: "#ffffff",
                fontWeight: 720,
                letterSpacing: "-0.035em",
                marginTop: 14,
              }}
            >
              Call about renewal preference
            </div>
            <div
              style={{
                marginTop: 30,
                padding: 20,
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.035)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                <Avatar
                  initials="PS"
                  tint="linear-gradient(145deg,#f97316,#ea580c)"
                />
                <div>
                  <div
                    style={{ fontSize: 22, color: "#ffffff", fontWeight: 680 }}
                  >
                    Priya Sharma
                  </div>
                  <div style={{ fontSize: 17, color: "#8f8b9c", marginTop: 4 }}>
                    Assigned · Due today
                  </div>
                </div>
              </div>
            </div>
            <Interactive.Div
              name="Complete follow-up button"
              style={{
                height: 62,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                marginTop: 24,
                borderRadius: 18,
                color: "#ffffff",
                backgroundColor: interpolateColors(
                  frame,
                  [62, 76],
                  ["rgba(124,58,237,1)", "rgba(34,197,94,1)"],
                ),
                fontSize: 22,
                fontWeight: 690,
              }}
            >
              <CheckIcon size={25} />
              {frame < 68 ? "Mark complete" : "Completed"}
            </Interactive.Div>
          </Interactive.Div>
          <Interactive.Div
            name="Conversation context card"
            style={{
              borderRadius: 30,
              padding: 30,
              border: "1px solid rgba(255,255,255,0.10)",
              backgroundColor: "rgba(25,25,35,0.94)",
              opacity: interpolate(frame, [24, 42], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [24, 42], ["34px 0px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={{ fontSize: 21, color: "#8f8b9c", fontWeight: 600 }}>
              Conversation context
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
                marginTop: 24,
              }}
            >
              <div
                style={{
                  alignSelf: "flex-end",
                  maxWidth: 330,
                  padding: "16px 18px",
                  borderRadius: "20px 20px 6px 20px",
                  backgroundColor: "rgba(124,58,237,0.18)",
                  color: "#e9e5f2",
                  fontSize: 18,
                  lineHeight: 1.4,
                }}
              >
                Hi Arjun, ready to renew your Strength plan?
              </div>
              <div
                style={{
                  alignSelf: "flex-start",
                  maxWidth: 330,
                  padding: "16px 18px",
                  borderRadius: "20px 20px 20px 6px",
                  backgroundColor: "rgba(255,255,255,0.07)",
                  color: "#e9e5f2",
                  fontSize: 18,
                  lineHeight: 1.4,
                }}
              >
                Yes—call me after 6 PM today.
              </div>
              <Interactive.Div
                name="Context captured note"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  marginTop: 12,
                  padding: "15px 17px",
                  borderRadius: 17,
                  backgroundColor: "rgba(34,197,94,0.10)",
                  color: "#86efac",
                  fontSize: 18,
                  fontWeight: 650,
                  opacity: interpolate(frame, [50, 68], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                }}
              >
                <CheckIcon size={23} />
                Next action captured
              </Interactive.Div>
            </div>
          </Interactive.Div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
