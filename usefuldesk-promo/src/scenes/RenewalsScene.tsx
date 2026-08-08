import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from "remotion";
import {Avatar, Brand, Eyebrow, SceneBackground, WhatsappIcon} from "../components";

const members = [
  {name: "Arjun Mehta", initials: "AM", plan: "Strength · Monthly", due: "Today", fee: "₹2,499", tint: "linear-gradient(145deg,#7c3aed,#4f46e5)"},
  {name: "Neha Kapoor", initials: "NK", plan: "Gold · Quarterly", due: "In 2 days", fee: "₹6,900", tint: "linear-gradient(145deg,#ec4899,#db2777)"},
  {name: "Rohan Shah", initials: "RS", plan: "HIIT · Monthly", due: "In 3 days", fee: "₹2,200", tint: "linear-gradient(145deg,#0ea5e9,#2563eb)"},
];

export const RenewalsScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{backgroundColor: "#0d0d14", overflow: "hidden"}}>
      <SceneBackground accent="amber" />
      <div style={{position: "absolute", inset: "70px 80px", display: "flex", flexDirection: "column", gap: 40}}>
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
          <Brand compact />
          <Eyebrow name="Renewals feature">Renewal-first</Eyebrow>
        </div>
        <Interactive.Div
          name="Renewals headline"
          style={{
            color: "#ffffff",
            fontSize: 72,
            lineHeight: 1.02,
            fontWeight: 780,
            letterSpacing: "-0.055em",
            maxWidth: 820,
            opacity: interpolate(frame, [0, 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [0, 20], ["0px 34px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          Start with who needs attention.
        </Interactive.Div>
        <Interactive.Div
          name="Expiring members action list"
          style={{
            flex: 1,
            padding: 28,
            borderRadius: 30,
            border: "1px solid rgba(255,255,255,0.11)",
            backgroundColor: "rgba(25,25,35,0.94)",
            boxShadow: "0 40px 90px rgba(0,0,0,0.32)",
            scale: interpolate(frame, [8, 28], [0.94, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({damping: 200}),
              output: "perceptual-scale",
            }),
          }}
        >
          <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22}}>
            <div>
              <div style={{fontSize: 28, fontWeight: 730, color: "#ffffff", letterSpacing: "-0.03em"}}>Expiring soon</div>
              <div style={{fontSize: 19, color: "#8f8b9c", marginTop: 6}}>Next 7 days · 17 members</div>
            </div>
            <div style={{padding: "9px 14px", borderRadius: 999, backgroundColor: "rgba(245,158,11,0.12)", color: "#fbbf24", fontSize: 18, fontWeight: 650}}>Action list</div>
          </div>
          <div style={{display: "flex", flexDirection: "column", gap: 12}}>
            {members.map((member, index) => (
              <Interactive.Div
                name={`${member.name} renewal row`}
                key={member.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "58px 1fr auto auto",
                  alignItems: "center",
                  gap: 16,
                  padding: "18px 18px",
                  borderRadius: 20,
                  border: index === 0 ? "1px solid rgba(139,92,246,0.46)" : "1px solid rgba(255,255,255,0.075)",
                  backgroundColor: index === 0 ? "rgba(124,58,237,0.11)" : "rgba(255,255,255,0.028)",
                  opacity: interpolate(frame, [18 + index * 8, 34 + index * 8], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                  translate: interpolate(frame, [18 + index * 8, 34 + index * 8], ["36px 0px", "0px 0px"], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                }}
              >
                <Avatar initials={member.initials} tint={member.tint} />
                <div>
                  <div style={{fontSize: 23, color: "#ffffff", fontWeight: 680, letterSpacing: "-0.025em"}}>{member.name}</div>
                  <div style={{fontSize: 17, color: "#8f8b9c", marginTop: 5}}>{member.plan}</div>
                </div>
                <div style={{textAlign: "right"}}>
                  <div style={{fontSize: 20, color: index === 0 ? "#fbbf24" : "#bbb7c6", fontWeight: 660}}>{member.due}</div>
                  <div style={{fontSize: 18, color: "#8f8b9c", marginTop: 5, fontVariantNumeric: "tabular-nums"}}>{member.fee}</div>
                </div>
                <div style={{width: 50, height: 50, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", backgroundColor: index === 0 ? "#7c3aed" : "rgba(255,255,255,0.07)"}}>
                  <WhatsappIcon size={25} />
                </div>
              </Interactive.Div>
            ))}
          </div>
        </Interactive.Div>
      </div>
    </AbsoluteFill>
  );
};
