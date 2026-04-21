import type { SegmentationObject } from '.';

/**
 * [Main -> Worker] 메인 스레드가 워커에게 내리는 명령
 */
export type SegmentationCommand = {
  type: 'START_ANALYSIS';
  imageData: ImageData;
};

/**
 * [Worker -> Main] 워커가 작업 중에 발생하는 사건(이벤트) 알림
 */
export type SegmentationEvent =
  | {
      type: 'MODEL_READY'; // 모델 로딩 완료, 작업 준비됨
    }
  | {
      type: 'PROGRESS_UPDATED'; // 분석 진행률 업데이트
      percent: number;
    }
  | {
      type: 'ANALYSIS_COMPLETED'; // 분석 최종 완료 및 데이터 전달
      objects: SegmentationObject[];
      imageWidth: number;
      imageHeight: number;
    }
  | {
      type: 'ERROR_OCCURRED'; // 작업 중 오류 발생
      message: string;
    };
