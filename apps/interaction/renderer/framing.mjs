export function avatarLayout({
  modelWidth,
  modelHeight,
  width,
  height,
  framing = "bust",
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  framingTop = 0.02,
  framingScaleBust = 1.38,
  framingScaleHalf = 1.16,
}) {
  if (framing === "full") {
    const fit = Math.min(width / modelWidth, height / modelHeight) * scale;
    return {
      scale: fit,
      x: width * (0.5 + offsetX),
      y: height * (0.5 + offsetY),
    };
  }

  const fill = framing === "half" ? framingScaleHalf : framingScaleBust;
  const portraitScale = (width / modelWidth) * fill * scale;
  const visibleHeight = modelHeight * portraitScale;
  const top = -visibleHeight * framingTop;

  return {
    scale: portraitScale,
    x: width * (0.5 + offsetX),
    y: top + visibleHeight / 2 + height * offsetY,
  };
}
