import "./index.css";
import { Composition, Folder } from "remotion";
import { UsefulDeskPromo } from "./Composition";
import { CollectScene } from "./scenes/CollectScene";
import { FinalScene } from "./scenes/FinalScene";
import { FollowUpScene } from "./scenes/FollowUpScene";
import { HookScene } from "./scenes/HookScene";
import { RenewalsScene } from "./scenes/RenewalsScene";
import { WhatsAppScene } from "./scenes/WhatsAppScene";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="UsefulDesk-Promo-Scenes">
        <Composition
          id="Hook"
          component={HookScene}
          durationInFrames={105}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Renewals"
          component={RenewalsScene}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="WhatsApp"
          component={WhatsAppScene}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Collect"
          component={CollectScene}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="FollowUp"
          component={FollowUpScene}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Final"
          component={FinalScene}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1080}
        />
      </Folder>
      <Composition
        id="UsefulDeskPromo"
        component={UsefulDeskPromo}
        durationInFrames={630}
        fps={30}
        width={1080}
        height={1080}
      />
    </>
  );
};
