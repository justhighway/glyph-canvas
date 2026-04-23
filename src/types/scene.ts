import { BoundingBox } from '.';

/**
 ** 풍경 모드에서 Gemini API가 감지한 물체 하나
 ** `/api/analyze-scene이 파싱해서 반환하는 단위 데이터
 */
export type SceneDetection = {
  /** Gemini가 반환한 오브젝트의 한국어 이름 */
  labelKo: string;
  /** 0~1 비율의 좌표 bounding box */
  boundingBox: BoundingBox;
};

/** 풍경 모드 전체 분석 결과 */
export type SceneAnalysisResult = {
  sceneDetections: SceneDetection[];
  imageWidth: number;
  imageHeight: number;
};
