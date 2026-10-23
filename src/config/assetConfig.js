/**
 * 외부 에셋(3D 모델·효과음) 설정
 * ------------------------------------------------------------
 * 파일이 없어도 게임은 기본 도형과 합성음으로 실행된다.
 * 파일을 넣으면 아래 이름 규칙에 맞는 것만 자동으로 불러온다. (자세한 방법: assets/README.md)
 */

export const ASSET_CONFIG = Object.freeze({
  modelFolder: 'assets/models/',
  // 부품 모델: assets/models/<부품 id>.glb  (부품 id 는 physicsConfig.js 의 parts 이름)
  // 그 밖의 모델: 아래 키 이름 + .glb
  extraModels: Object.freeze(['launchPad', 'landingPad', 'planet']),
  modelExtension: '.glb',

  audioFolder: 'assets/audio/',
  // 효과음: assets/audio/<이름>.mp3 (.ogg, .wav 도 가능). 없으면 합성음 사용
  sounds: Object.freeze(['engine', 'liftoff', 'stage', 'explosion', 'landing']),
  audioExtensions: Object.freeze(['.mp3', '.ogg', '.wav']),
});
