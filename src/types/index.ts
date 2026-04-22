import { PortraitAnalysisResult } from './portrait';
import { SceneAnalysisResult } from './scene';

/** 지원 언어 */
export type Language = 'ko' | 'en' | 'jp';

/** 분석 모드 (인물 or 풍경) */
export type AnalysisMode = 'portrait' | 'scene';

/**
 ** 이미지 분석 프로세스의 현재 단계
 ** 이 값을 기반으로 로딩 스피너 / 결과 / 에러 화면 중 UI를 결정
 */
export type AnalysisPhase = 'idle' | 'loading' | 'done' | 'error';

/**
 ** 0~1 사이 비율값으로 표현한 사각형 영역
 ** 이미지 크기와 무관하게 위치를 표현할 수 있어 모델 출력을 정규화할 때 사용함
 ** 예: `x=0.5`는 이미지 가로 폭의 정중앙
 */
export type BoundingBox = {
  /** 박스 완쪽 상단 x 좌표 */
  x: number;
  /** 박스 왼쪽 상단 y 좌표 */
  y: number;
  /** 박스 너비 */
  width: number;
  /** 박스 높이 */
  height: number;
};

/** 2D 좌표의 포인트 */
export type Point = {
  x: number;
  y: number;
};

/** RGB 컬러 */
export type RGB = {
  r: number;
  g: number;
  b: number;
};

/**
 ** 모드별 분석 결과 유니온
 ** mode 필드로 타입을 좁혀 data에 안전하게 접근 가능
 * ```
 * if (result.mode === 'portrait') {
 *   result.data.bodyPartDetections // Typescript가 타입을 알고 있음
 * }
 * ```
 */
export type AnalysisResult =
  | { mode: 'portrait'; data: PortraitAnalysisResult }
  | { mode: 'scene'; data: SceneAnalysisResult };
