// 샘플 상품 30개, 샘플 이미지, 최근 4주 조건별 판매 데이터를 넣는다.
// 실행하면 테이블을 만들고(supabase/schema.sql), 기존 상품·판매 데이터를 모두 지우고 새로 넣는다.
const fs = require('fs');
const path = require('path');
const { sql, CODES, isoWeek, saveProduct, saveSales } = require('./db');

const IMG_DIR = path.join(__dirname, 'public', 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });

const ALL_AGES = CODES.ages;
const A = (...xs) => xs.map((x) => (x === 60 ? '60대 이상' : `${x}대`));
const BOTH = ['본인용', '선물용'];

// [id, 상품명, 카테고리, 정가, 할인가, 성별, 연령대, 용도, 추천문구, 재고, 메모, 아이콘, 인기도]
const PRODUCTS = [
  ['P001', '남성 캐주얼 니트 가디건', '패션', 59000, 49000, '남성', A(30, 40, 50), BOTH, '출근룩과 주말룩 모두 무난한 기본 가디건', 42, 'M·L·XL 재고 고름. 어깨 넉넉한 편이라 정사이즈 안내', 'sweater', 7],
  ['P002', '여성 울 블렌드 롱코트', '패션', 159000, null, '여성', A(20, 30, 40), ['본인용'], '가볍고 따뜻한 겨울 데일리 코트', 18, '베이지 색상 문의 많음. 드라이클리닝 필수', 'coat', 6],
  ['P003', '소가죽 남성 벨트 선물세트', '패션', 45000, 39000, '남성', A(40, 50, 60), ['선물용'], '쇼핑백·카드 포함, 아버지 선물로 인기', 35, '길이 조절 가능(자가 커팅). 각인 서비스 없음', 'belt', 8],
  ['P004', '캐시미어 혼방 머플러', '패션', 69000, null, '공용', A(30, 40, 50, 60), ['선물용'], '부드러운 촉감, 남녀 모두 어울리는 색감', 27, '그레이·네이비가 남성 선물로 무난', 'scarf', 7],
  ['P005', '데일리 미니 크로스백', '패션', 39000, 29000, '여성', A(10, 20, 30), BOTH, '가볍고 수납 넉넉한 데일리 가방', 50, '스트랩 길이 조절 가능. 블랙 판매 1위', 'bag', 6],
  ['P006', '남성 골프 기능성 티셔츠', '패션', 79000, null, '남성', A(40, 50, 60), BOTH, '땀 흡수가 빠른 쿨링 소재 골프 티', 0, '전 사이즈 품절. 다음 입고 11월 2주차 예정', 'shirt', 9],
  ['P007', '쿠션 데일리 운동화', '패션', 89000, 69000, '공용', A(10, 20, 30), ['본인용'], '오래 걸어도 편한 쿠션 러닝화', 23, '발볼 넓은 분은 반 치수 크게 안내', 'shoe', 5],

  ['P008', '수분 진정 앰플 세트', '뷰티', 42000, 33600, '여성', A(20, 30, 40), BOTH, '건조하고 예민한 피부를 위한 진정 앰플', 64, '민감성 테스트 완료. 본품+미니 2개 구성', 'bottle', 8],
  ['P009', '남성 올인원 스킨케어 세트', '뷰티', 35000, null, '남성', A(20, 30, 40, 50), BOTH, '한 병으로 끝내는 간편 남성 스킨케어', 38, '향 약함. 지성 피부 반응 좋음', 'bottle', 7],
  ['P010', '안티에이징 크림 기획세트', '뷰티', 98000, 78400, '여성', A(40, 50, 60), BOTH, '탄력 케어 크림, 어머니 선물로 인기', 21, '선물 포장 무료. 50ml+15ml 구성', 'jar', 8],
  ['P011', '립 틴트 3종 세트', '뷰티', 24000, null, '여성', A(10, 20), BOTH, '데일리 컬러 3종, 첫 틴트로 추천', 80, '코랄·로즈·레드 구성 고정(교환 불가)', 'lipstick', 6],
  ['P012', '니치 향수 50ml', '뷰티', 128000, null, '공용', A(20, 30, 40), ['선물용'], '은은한 우디 향, 특별한 날 선물', 9, '시향지 요청 시 함께 발송 가능', 'perfume', 5],
  ['P013', '두피 케어 샴푸 세트', '뷰티', 32000, 27200, '공용', A(30, 40, 50, 60), ['본인용'], '두피가 예민한 분을 위한 약산성 샴푸', 55, '정기배송 문의 시 쇼핑몰 정기배송 메뉴 안내', 'bottle', 6],

  ['P014', '6년근 홍삼정 스틱 30포', '건강식품', 89000, 71200, '공용', A(40, 50, 60), BOTH, '하루 한 포, 부모님 건강 선물 1순위', 46, '명절 전 2주 배송 지연 가능성 안내', 'giftbox', 10],
  ['P015', '종합비타민 90정', '건강식품', 29000, null, '공용', A(20, 30, 40, 50), ['본인용'], '하루 한 알로 챙기는 기본 영양', 120, '임산부는 섭취 전 상담 권장 안내', 'pill', 7],
  ['P016', '루테인 지아잔틴 60캡슐', '건강식품', 39000, null, '공용', A(40, 50, 60), BOTH, '눈 건강이 신경 쓰이는 분께', 33, '2개월분. 2개 구매 시 사은품 증정 중', 'pill', 7],
  ['P017', '남성 활력 옥타코사놀', '건강식품', 45000, 38000, '남성', A(40, 50, 60), BOTH, '바쁜 중년 남성의 활력 관리', 28, '복용 중인 약 있으면 의사 상담 권장', 'pill', 6],
  ['P018', '저분자 콜라겐 젤리 스틱', '건강식품', 36000, null, '여성', A(20, 30, 40), ['본인용'], '맛있게 챙기는 콜라겐, 하루 한 포', 44, '복숭아 맛. 냉장 보관 시 더 맛있음', 'giftbox', 6],
  ['P019', '프리미엄 견과 선물세트', '건강식품', 49000, 44100, '공용', A(30, 40, 50, 60), ['선물용'], '고급 보자기 포장의 견과 6종 세트', 37, '견과 알레르기 여부 꼭 확인', 'giftbox', 8],
  ['P020', '청소년 성장 칼슘 츄어블', '건강식품', 33000, null, '공용', A(10), ['본인용'], '씹어 먹는 칼슘·비타민D', 0, '품절. 대체 상품으로 종합비타민(P015) 안내', 'pill', 4],

  ['P021', '무선 노이즈캔슬링 이어폰', '전자기기', 199000, 169000, '공용', A(10, 20, 30), BOTH, '출퇴근길을 조용하게, 최대 30시간 재생', 15, '아이폰·안드로이드 모두 호환. 1년 무상 AS', 'earbuds', 9],
  ['P022', '스마트워치 헬스 에디션', '전자기기', 259000, null, '공용', A(30, 40, 50), BOTH, '심박·수면·걸음 수를 한눈에', 12, '안드로이드 전용 기능 일부 있음, 기종 확인 필요', 'watch', 7],
  ['P023', '저소음 마사지건', '전자기기', 129000, 99000, '공용', A(30, 40, 50, 60), BOTH, '뭉친 어깨를 집에서 시원하게', 26, '헤드 4종 포함. 소음 40dB대 강조', 'massage', 8],
  ['P024', '휴대용 블루투스 스피커', '전자기기', 69000, null, '공용', A(10, 20, 30), ['본인용'], '생활 방수, 캠핑·여행용 스피커', 31, '2대 연결 스테레오 지원', 'speaker', 5],
  ['P025', '전동 면도기 프리미엄', '전자기기', 149000, 119000, '남성', A(30, 40, 50, 60), BOTH, '깔끔한 밀착 면도, 아버지 선물 인기', 19, '세척 스테이션 포함 모델. 2년 무상 AS', 'shaver', 9],
  ['P026', '무선 고속 충전 패드', '전자기기', 29000, null, '공용', A(20, 30, 40), ['본인용'], '책상 위에 두기 좋은 15W 충전 패드', 70, '어댑터 별도. 케이스 두께 5mm 이하 권장', 'charger', 4],

  ['P027', '아로마 디퓨저 선물세트', '리빙', 38000, 30400, '여성', A(20, 30, 40), BOTH, '은은한 향으로 집들이·생일 선물', 40, '향 3종 중 선택 가능. 화이트머스크 인기', 'diffuser', 6],
  ['P028', '메모리폼 경추 베개', '리빙', 59000, null, '공용', A(30, 40, 50, 60), BOTH, '목과 어깨가 편한 숙면 베개', 22, '커버 분리 세탁 가능. 높이 2단 조절', 'pillow', 6],
  ['P029', '핸드드립 커피 세트', '리빙', 55000, 46750, '공용', A(20, 30, 40, 50), ['선물용'], '드리퍼·서버·원두 200g 구성', 17, '원두는 분쇄/홀빈 선택 가능', 'mug', 6],
  ['P030', '온열 안마 방석', '리빙', 99000, 79000, '공용', A(50, 60), ['선물용'], '등·허리를 따뜻하게 풀어주는 안마 방석', 13, '차량용 시거잭 어댑터 포함', 'cushion', 8],
];

const CATEGORY_COLORS = {
  패션: ['#5b7bd5', '#e8eefc'],
  뷰티: ['#d4608a', '#fbe9f0'],
  건강식품: ['#3d9a6b', '#e4f4ea'],
  전자기기: ['#4a5568', '#e9ecf1'],
  리빙: ['#c98a3c', '#fbf0e2'],
};

// 단순한 SVG 아이콘. c = 주색, l = 배경색
const ICONS = {
  sweater: (c) => `<path d="M160 70 L115 88 L80 150 L112 166 L130 130 L130 238 L270 238 L270 130 L288 166 L320 150 L285 88 L240 70 Q200 100 160 70 Z" fill="${c}"/><path d="M160 70 Q200 100 240 70" stroke="#fff" stroke-width="5" fill="none" opacity=".6"/><path d="M200 92 L200 238" stroke="#fff" stroke-width="4" opacity=".5"/><circle cx="200" cy="130" r="5" fill="#fff"/><circle cx="200" cy="165" r="5" fill="#fff"/><circle cx="200" cy="200" r="5" fill="#fff"/>`,
  coat: (c) => `<path d="M165 55 L120 75 L95 165 L118 172 L132 125 L128 262 L272 262 L268 125 L282 172 L305 165 L280 75 L235 55 L200 110 Z" fill="${c}"/><path d="M165 55 L200 110 L235 55" stroke="#fff" stroke-width="5" fill="none" opacity=".6"/><circle cx="215" cy="150" r="6" fill="#fff"/><circle cx="215" cy="190" r="6" fill="#fff"/><circle cx="215" cy="230" r="6" fill="#fff"/>`,
  belt: (c) => `<rect x="60" y="130" width="280" height="40" rx="8" fill="${c}"/><rect x="230" y="118" width="64" height="64" rx="8" fill="none" stroke="#8a6d2b" stroke-width="10"/><rect x="258" y="140" width="10" height="20" fill="#8a6d2b"/><circle cx="110" cy="150" r="5" fill="#fff" opacity=".7"/><circle cx="140" cy="150" r="5" fill="#fff" opacity=".7"/><circle cx="170" cy="150" r="5" fill="#fff" opacity=".7"/>`,
  scarf: (c) => `<path d="M120 70 Q200 40 280 70 L280 110 Q200 80 120 110 Z" fill="${c}"/><path d="M150 100 L180 100 L195 230 L160 235 Z" fill="${c}" opacity=".85"/><path d="M210 95 L245 92 L250 225 L215 228 Z" fill="${c}"/><path d="M162 235 v18 M172 234 v18 M182 233 v18 M192 232 v18 M218 228 v18 M228 227 v18 M238 226 v18 M248 225 v18" stroke="${c}" stroke-width="4"/><path d="M130 80 L270 80 M130 95 L270 95" stroke="#fff" stroke-width="3" opacity=".4"/>`,
  bag: (c) => `<path d="M150 120 Q150 60 200 60 Q250 60 250 120" stroke="${c}" stroke-width="10" fill="none"/><rect x="115" y="115" width="170" height="125" rx="20" fill="${c}"/><rect x="115" y="115" width="170" height="45" rx="20" fill="#fff" opacity=".25"/><rect x="190" y="150" width="20" height="16" rx="3" fill="#fff"/>`,
  shirt: (c) => `<path d="M160 70 L110 92 L80 140 L120 160 L135 135 L135 235 L265 235 L265 135 L280 160 L320 140 L290 92 L240 70 Q200 95 160 70 Z" fill="${c}"/><path d="M185 76 L200 110 L215 76" fill="#fff" opacity=".7"/><circle cx="200" cy="125" r="4" fill="#fff"/><path d="M230 150 h18" stroke="#fff" stroke-width="4" opacity=".7"/>`,
  shoe: (c) => `<path d="M80 200 L80 150 Q80 120 110 125 L170 135 Q200 105 230 120 L300 170 Q330 180 330 200 L330 215 L80 215 Z" fill="${c}"/><rect x="75" y="210" width="260" height="20" rx="10" fill="#fff" stroke="${c}" stroke-width="4"/><path d="M180 135 L195 155 M200 128 L215 148 M220 130 L235 150" stroke="#fff" stroke-width="5"/>`,
  bottle: (c) => `<rect x="160" y="110" width="80" height="140" rx="18" fill="${c}"/><rect x="180" y="75" width="40" height="40" rx="6" fill="${c}" opacity=".7"/><rect x="190" y="45" width="20" height="35" rx="8" fill="${c}" opacity=".9"/><rect x="172" y="150" width="56" height="60" rx="6" fill="#fff" opacity=".85"/><path d="M185 170 h30 M185 185 h22" stroke="${c}" stroke-width="4"/>`,
  jar: (c) => `<rect x="130" y="95" width="140" height="35" rx="10" fill="${c}" opacity=".8"/><rect x="120" y="125" width="160" height="110" rx="24" fill="${c}"/><rect x="150" y="160" width="100" height="45" rx="8" fill="#fff" opacity=".85"/><path d="M165 182 h70" stroke="${c}" stroke-width="5"/>`,
  lipstick: (c) => `<rect x="120" y="150" width="50" height="100" rx="6" fill="#444"/><rect x="125" y="115" width="40" height="40" fill="#c9a34a"/><path d="M128 115 L128 70 L162 55 L162 115 Z" fill="${c}"/><rect x="230" y="150" width="50" height="100" rx="6" fill="#444"/><rect x="235" y="115" width="40" height="40" fill="#c9a34a"/><path d="M238 115 L238 80 L272 65 L272 115 Z" fill="${c}" opacity=".7"/><rect x="175" y="150" width="50" height="100" rx="6" fill="#444"/><rect x="180" y="115" width="40" height="40" fill="#c9a34a"/><path d="M183 115 L183 60 L217 45 L217 115 Z" fill="${c}" opacity=".85"/>`,
  perfume: (c) => `<rect x="145" y="115" width="110" height="130" rx="16" fill="${c}" opacity=".85"/><rect x="160" y="130" width="80" height="100" rx="10" fill="#fff" opacity=".35"/><rect x="185" y="90" width="30" height="28" fill="#c9a34a"/><rect x="175" y="55" width="50" height="38" rx="10" fill="#333"/><text x="200" y="190" font-family="serif" font-size="26" fill="#fff" text-anchor="middle">N°5</text>`,
  giftbox: (c) => `<rect x="110" y="125" width="180" height="120" rx="8" fill="${c}"/><rect x="100" y="100" width="200" height="35" rx="6" fill="${c}" opacity=".85"/><rect x="190" y="100" width="20" height="145" fill="#f2c94c"/><path d="M200 100 Q160 50 150 85 Q150 100 200 100 Q240 50 250 85 Q250 100 200 100" fill="#f2c94c"/>`,
  pill: (c) => `<rect x="125" y="95" width="100" height="150" rx="14" fill="${c}"/><rect x="118" y="70" width="114" height="35" rx="8" fill="#fff" stroke="${c}" stroke-width="5"/><rect x="140" y="140" width="70" height="60" rx="6" fill="#fff" opacity=".9"/><path d="M175 152 v36 M157 170 h36" stroke="${c}" stroke-width="8"/><g transform="rotate(-30 280 210)"><rect x="250" y="195" width="60" height="28" rx="14" fill="${c}" opacity=".6"/><rect x="250" y="195" width="30" height="28" rx="14" fill="#fff" stroke="${c}" stroke-width="3"/></g>`,
  earbuds: (c) => `<rect x="130" y="150" width="140" height="90" rx="40" fill="#fff" stroke="${c}" stroke-width="6"/><path d="M135 190 h130" stroke="${c}" stroke-width="3"/><circle cx="160" cy="105" r="28" fill="${c}"/><rect x="152" y="105" width="16" height="45" rx="8" fill="${c}"/><circle cx="240" cy="105" r="28" fill="${c}"/><rect x="232" y="105" width="16" height="45" rx="8" fill="${c}"/><circle cx="160" cy="105" r="10" fill="#fff" opacity=".4"/><circle cx="240" cy="105" r="10" fill="#fff" opacity=".4"/>`,
  watch: (c) => `<rect x="170" y="40" width="60" height="220" rx="16" fill="${c}" opacity=".6"/><rect x="140" y="95" width="120" height="110" rx="26" fill="${c}"/><rect x="152" y="107" width="96" height="86" rx="18" fill="#1d2330"/><path d="M165 155 h18 l8 -18 l12 34 l8 -16 h24" stroke="#5fe3a1" stroke-width="5" fill="none"/>`,
  massage: (c) => `<rect x="110" y="85" width="190" height="70" rx="35" fill="${c}"/><rect x="185" y="140" width="45" height="110" rx="16" fill="${c}" opacity=".85"/><circle cx="100" cy="120" r="30" fill="#e0e4ea" stroke="${c}" stroke-width="6"/><circle cx="270" cy="120" r="12" fill="#fff" opacity=".5"/>`,
  speaker: (c) => `<rect x="105" y="100" width="190" height="120" rx="55" fill="${c}"/><circle cx="160" cy="160" r="32" fill="#1d2330"/><circle cx="160" cy="160" r="14" fill="#fff" opacity=".3"/><circle cx="240" cy="160" r="32" fill="#1d2330"/><circle cx="240" cy="160" r="14" fill="#fff" opacity=".3"/><rect x="180" y="85" width="40" height="18" rx="6" fill="${c}"/>`,
  shaver: (c) => `<rect x="150" y="55" width="100" height="60" rx="26" fill="#cfd5de"/><path d="M165 75 h70 M165 90 h70" stroke="#9aa3b0" stroke-width="5"/><path d="M160 115 L240 115 L228 255 L172 255 Z" fill="${c}"/><circle cx="200" cy="160" r="12" fill="#fff" opacity=".85"/><rect x="190" y="195" width="20" height="35" rx="8" fill="#fff" opacity=".3"/>`,
  charger: (c) => `<ellipse cx="200" cy="215" rx="120" ry="28" fill="${c}"/><ellipse cx="200" cy="208" rx="105" ry="20" fill="#fff" opacity=".25"/><rect x="160" y="60" width="80" height="150" rx="14" fill="#1d2330"/><rect x="168" y="72" width="64" height="120" rx="6" fill="#5b7bd5" opacity=".6"/><path d="M205 110 L188 140 H204 L195 165 L216 132 H200 Z" fill="#f2c94c"/>`,
  diffuser: (c) => `<path d="M150 150 Q150 130 170 130 L230 130 Q250 130 250 150 L262 245 L138 245 Z" fill="${c}" opacity=".85"/><rect x="185" y="112" width="30" height="22" fill="#333"/><path d="M195 112 L160 40 M200 112 L200 35 M205 112 L245 42 M198 112 L178 38 M202 112 L225 36" stroke="#6b4a2b" stroke-width="5"/><rect x="160" y="175" width="80" height="40" rx="6" fill="#fff" opacity=".7"/>`,
  pillow: (c) => `<path d="M90 120 Q90 85 130 90 Q200 105 270 90 Q310 85 310 120 L310 190 Q310 225 270 220 Q200 205 130 220 Q90 225 90 190 Z" fill="${c}"/><path d="M110 130 Q200 145 290 130" stroke="#fff" stroke-width="5" fill="none" opacity=".5"/><path d="M110 180 Q200 165 290 180" stroke="#fff" stroke-width="5" fill="none" opacity=".5"/>`,
  mug: (c) => `<path d="M135 110 L265 110 L255 240 Q255 250 245 250 L155 250 Q145 250 145 240 Z" fill="${c}"/><path d="M262 140 Q310 140 305 180 Q300 215 255 210" stroke="${c}" stroke-width="14" fill="none"/><path d="M175 95 Q165 75 180 60 Q195 45 185 25 M215 95 Q205 75 220 60 Q235 45 225 25" stroke="${c}" stroke-width="5" fill="none" opacity=".5"/><rect x="165" y="150" width="70" height="40" rx="6" fill="#fff" opacity=".75"/>`,
  cushion: (c) => `<rect x="95" y="80" width="210" height="160" rx="34" fill="${c}"/><rect x="115" y="100" width="170" height="120" rx="22" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="10 8" opacity=".7"/><path d="M180 125 Q200 105 220 125 Q200 145 180 125 Z M180 175 Q200 155 220 175 Q200 195 180 175 Z" fill="#f2994a"/>`,
};

function svgImage(icon, category) {
  const [c, l] = CATEGORY_COLORS[category] || ['#7a8699', '#eef1f5'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
<rect width="400" height="300" fill="${l}"/>
<circle cx="200" cy="150" r="125" fill="#fff" opacity=".55"/>
${ICONS[icon](c)}
</svg>
`;
}

function writeImages() {
  for (const p of PRODUCTS) {
    fs.writeFileSync(path.join(IMG_DIR, `${p[0]}.svg`), svgImage(p[11], p[2]));
  }
  fs.writeFileSync(path.join(IMG_DIR, 'default.svg'), svgImage('giftbox', '기타'));
}

// 결정적 난수 (매번 같은 샘플 데이터)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seed() {
  writeImages();
  const rand = mulberry32(20261030);

  // 지난주까지 최근 4주
  const today = new Date();
  const weeks = [4, 3, 2, 1].map((i) => isoWeek(new Date(today.getTime() - i * 7 * 86400000)));

  const sales = [];
  for (const [id, , , , , target_gender, target_ages, purposes, , , , , pop] of PRODUCTS) {
    for (const week of weeks) {
      for (const gender of CODES.genders) {
        for (const age_group of ALL_AGES) {
          for (const purpose of CODES.purposes) {
            const match = (target_gender === '공용' || target_gender === gender)
              && target_ages.includes(age_group) && purposes.includes(purpose);
            let quantity = 0;
            if (match) {
              quantity = Math.round(pop * (1 + rand() * 3));
            } else if (rand() < 0.15) {
              quantity = Math.floor(rand() * 3); // 대상 밖 소량 구매
            }
            if (quantity > 0) sales.push({ product_id: id, week, gender, age_group, purpose, quantity });
          }
        }
      }
    }
  }

  await sql.unsafe(fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8'));
  await sql.begin(async (tx) => {
    await tx`DELETE FROM sales`;
    await tx`DELETE FROM products`;
    for (const [id, name, category, price, sale_price, target_gender, target_ages, purposes, recommend_text, stock, memo] of PRODUCTS) {
      await saveProduct({
        id, name, category, price, sale_price, image: `images/${id}.svg`, link: '',
        target_gender, target_ages, purposes, recommend_text, stock, memo,
      }, tx);
    }
    await saveSales(sales, tx);
  });

  const [{ pc, sc }] = await sql`SELECT (SELECT COUNT(*) FROM products)::int AS pc, (SELECT COUNT(*) FROM sales)::int AS sc`;
  console.log(`샘플 상품 ${pc}개, 판매 데이터 ${sc}행 (${weeks[0]} ~ ${weeks[3]}) 을 넣었습니다.`);
}

seed()
  .catch((e) => { console.error('샘플 데이터를 넣지 못했습니다:', e.message); process.exitCode = 1; })
  .finally(() => sql.end());
