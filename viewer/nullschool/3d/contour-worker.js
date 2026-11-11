import { marchContours } from "./contours.js";

self.onmessage = ({ data }) => {
  try {
    const result = marchContours(data);
    self.postMessage(
      { result },
      result.contours.map((line) => line.points.buffer),
    );
  } catch (error) {
    self.postMessage({ error: error.message || "等值线计算失败" });
  }
};
