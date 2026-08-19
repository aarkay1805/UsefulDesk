import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";

export const SceneBackground: React.FC<{
  accent?: "violet" | "green" | "amber";
}> = ({ accent = "violet" }) => {
  const frame = useCurrentFrame();
  const accentColor =
    accent === "green"
      ? "rgba(34,197,94,0.22)"
      : accent === "amber"
        ? "rgba(245,158,11,0.20)"
        : "rgba(124,58,237,0.26)";

  return (
    <Interactive.Div
      name="Ambient background"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: "#0d0d14",
      }}
    >
      <Interactive.Div
        name="Top glow"
        style={{
          position: "absolute",
          width: 720,
          height: 720,
          borderRadius: 999,
          top: -390,
          right: -170,
          background: `radial-gradient(circle, ${accentColor} 0%, rgba(13,13,20,0) 69%)`,
          translate: interpolate(frame, [0, 120], ["0px 0px", "-34px 32px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <Interactive.Div
        name="Bottom glow"
        style={{
          position: "absolute",
          width: 620,
          height: 620,
          borderRadius: 999,
          bottom: -400,
          left: -160,
          background:
            "radial-gradient(circle, rgba(124,58,237,0.15) 0%, rgba(13,13,20,0) 70%)",
          translate: interpolate(frame, [0, 120], ["0px 0px", "40px -24px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.14,
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.18) 0.7px, transparent 0.7px)",
          backgroundSize: "24px 24px",
          maskImage: "linear-gradient(to bottom, black, transparent 82%)",
        }}
      />
    </Interactive.Div>
  );
};

export const Brand: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <Interactive.Div
    name="UsefulDesk brand"
    style={{
      display: "flex",
      alignItems: "center",
      gap: compact ? 14 : 18,
      color: "#ffffff",
      fontSize: compact ? 31 : 42,
      lineHeight: 1,
      fontWeight: 760,
      letterSpacing: "-0.035em",
    }}
  >
    <div
      style={{
        width: compact ? 48 : 60,
        height: compact ? 48 : 60,
        borderRadius: compact ? 14 : 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #8b5cf6 0%, #6d28d9 100%)",
        boxShadow: "0 18px 60px rgba(124,58,237,0.28)",
      }}
    >
      <svg
        width={compact ? 28 : 35}
        height={compact ? 28 : 35}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </div>
    UsefulDesk
  </Interactive.Div>
);

export const Eyebrow: React.FC<{ children: React.ReactNode; name: string }> = ({
  children,
  name,
}) => (
  <Interactive.Div
    name={name}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 11,
      padding: "10px 16px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.13)",
      backgroundColor: "rgba(255,255,255,0.055)",
      color: "#c4b5fd",
      fontSize: 24,
      lineHeight: 1,
      fontWeight: 650,
      letterSpacing: "0.01em",
    }}
  >
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 99,
        backgroundColor: "#8b5cf6",
        boxShadow: "0 0 20px #8b5cf6",
      }}
    />
    {children}
  </Interactive.Div>
);

export const Avatar: React.FC<{ initials: string; tint: string }> = ({
  initials,
  tint,
}) => (
  <div
    style={{
      width: 58,
      height: 58,
      borderRadius: 18,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      color: "#ffffff",
      background: tint,
      fontSize: 21,
      fontWeight: 760,
      letterSpacing: "-0.02em",
    }}
  >
    {initials}
  </div>
);

export const CheckIcon: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m5 12 4 4L19 6" />
  </svg>
);

export const ArrowIcon: React.FC = () => (
  <svg
    width="34"
    height="34"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

export const WhatsappIcon: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.43L3.5 20.5l1.58-4.24A8.5 8.5 0 1 1 20.5 11.5Z" />
    <path d="M8.7 8.2c.35 3.6 2.4 5.7 6.1 6.1" />
    <path d="m8.7 8.2 1.45-.45 1.05 2-1 .9M14.8 14.3l.45-1.45-2-1.05-.9 1" />
  </svg>
);
