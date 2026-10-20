import React from "react";
import { Text } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { Card, s } from "./ui";

export default function HowItWorks() {
  const player = useVideoPlayer(
    require("../assets/loran-how-it-works.mp4"),
    (instance) => {
      instance.loop = false;
    },
  );

  return (
    <Card>
      <Text style={s.h2}>How loRan Shopper works</Text>

      <Text style={[s.text, { marginBottom: 14 }]}>
        Watch this short guide to placing and tracking an
        order. Tap play to begin.
      </Text>

      <VideoView
        player={player}
        nativeControls
        contentFit="contain"
        style={{
          width: "100%",
          aspectRatio: 16 / 9,
          backgroundColor: "#153f31",
          borderRadius: 12,
        }}
      />
    </Card>
  );
}