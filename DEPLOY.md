# Vercel 배포 가이드 (Supabase 연결)

작성일 2026-10-30 · 대상: GitHub `syaaa1002-hub/AA`

## 1. 왜 Supabase가 필요한가

처음 버전(SQLite, 현재 `offline` 브랜치)은 Vercel에서 제대로 동작하지 않아 아래처럼 바꿨습니다.

| 처음 버전 | Vercel에서 생기는 문제 | 바꾼 내용 |
| --- | --- | --- |
| SQLite 파일 `data/app.db`에 저장 | Vercel 서버는 파일을 영구 저장하지 못해 수정 내용이 사라짐 | **Supabase(PostgreSQL)** 에 저장 |
| PIN 인증 토큰을 서버 메모리에 보관 | 요청마다 다른 서버가 처리할 수 있어 로그인이 풀림 | 서버에 저장하지 않는 서명 토큰(`AUTH_SECRET`) |
| PIN 5회 오류 잠금을 메모리에 보관 | 서버마다 따로 세서 잠금이 안 걸림 | 잠금 기록을 Supabase `login_attempts` 테이블에 저장, 잠금 5분 |
| PIN 숫자 4자리 고정 | 인터넷 공개 시 약함 | 4~12자리 허용 (6자리 이상 권장) |
| 관리 화면 이미지 목록을 폴더에서 읽음 | Vercel 함수 안에서는 폴더가 안 보일 수 있음 | DB에 쓰인 이미지와 합쳐서 표시 |
| `app.listen()`으로만 실행 | Vercel은 앱을 함수로 실행 | `module.exports = app`, 로컬에서만 listen |

- `public/` 화면 파일은 Vercel CDN이 그대로 제공합니다. 엑셀 기능도 그대로 동작합니다(파일 4MB 이하).
- Supabase 테이블에는 RLS(행 수준 보안)를 켜 두어, Supabase 공개 API 키로는 재고·메모를 읽을 수 없습니다. 서버는 DB 소유자 계정으로 직접 접속하므로 영향이 없습니다.

## 2. 배포 전에 먼저 정할 것 (중요)

1. **사내망에서 외부 사이트 접속이 되는가?** 사내망이 인터넷과 분리되어 있으면 `*.vercel.app`에 접속할 수 없습니다. 상담원 PC에서 아무 `vercel.app` 사이트가 열리는지 먼저 확인하세요. 안 되면 `offline` 브랜치 버전을 사내 PC에서 실행하세요.
2. **내부 데이터를 외부 클라우드에 올려도 되는가?** 재고·내부 메모·판매 데이터가 외부 서버에 저장되고, 주소를 아는 누구나 화면에 접속할 수 있습니다. 보안 규정이나 승인이 필요한지 확인하세요.
3. **PIN은 6자리 이상으로.** 잠금은 IP별이라, 여러 IP에서 시도하면 4자리 PIN은 뚫릴 수 있습니다.

## 3. 사용자가 직접 해야 할 일

계정 만들기, 비밀번호·키 다루기는 직접 하셔야 합니다. **비밀번호나 연결 문자열은 채팅에 붙여 넣지 말고** `.env` 파일과 Vercel 화면에만 입력하세요.

### 3-1. Supabase 프로젝트 만들기 (약 5분)

1. https://supabase.com 에서 GitHub 계정으로 가입합니다.
2. **New project** → 이름(예: `product-recommender`), **Database Password**(길고 복잡하게, 따로 보관), **Region: Northeast Asia (Seoul)** 를 고르고 만듭니다. 무료 플랜이면 됩니다.
3. 프로젝트가 준비되면 위쪽 **Connect** 버튼 → **Transaction pooler**를 고르고 연결 문자열을 복사합니다. `[YOUR-PASSWORD]`를 2번의 비밀번호로 바꿉니다. 포트가 **6543**인지 확인하세요.

   ```
   postgresql://postgres.[프로젝트ID]:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres
   ```

   비밀번호에 `@`, `#`, `/` 같은 특수문자가 있으면 연결이 실패할 수 있습니다. 영문·숫자로 된 긴 비밀번호를 권장합니다.

### 3-2. 내 PC에서 테이블과 샘플 데이터 넣기

1. `product-recommender/.env`를 아래처럼 채웁니다. (`.env.example` 참고)

   ```
   DATABASE_URL=3-1에서 복사한 연결 문자열
   STAFF_PIN=6자리 이상 숫자
   AUTH_SECRET=아래 명령으로 만든 긴 문자열
   PORT=3000
   ```

   `AUTH_SECRET` 만들기:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. 테이블을 만들고 샘플 데이터를 넣은 뒤 내 PC에서 먼저 확인합니다. `npm run seed`가 `supabase/schema.sql`을 자동 실행하므로 SQL Editor에 따로 붙여 넣을 필요는 없습니다. (**seed는 기존 상품·판매 데이터를 지우므로 운영 시작 후에는 실행하지 마세요**)

   ```bash
   npm install && npm run seed && npm start
   ```

   `샘플 상품 30개, 판매 데이터 1084행 … 을 넣었습니다`가 나오고, `http://localhost:3000`에서 상품이 보이면 성공입니다. Supabase **Table Editor**에서도 `products`, `sales` 테이블이 보입니다.

### 3-3. GitHub에 올리기

코드 변경분을 커밋·push합니다. (Claude에게 "커밋하고 push해줘"라고 해도 됩니다. `.env`는 올라가지 않습니다)

### 3-4. Vercel에 배포하기 (약 5분)

1. https://vercel.com 에서 **GitHub 계정(syaaa1002-hub)** 으로 가입합니다. Hobby(무료) 플랜이면 됩니다.
2. **Add New → Project** → GitHub 저장소 `syaaa1002-hub/AA`를 **Import** 합니다. (저장소가 안 보이면 GitHub 앱 권한에서 이 저장소를 허용)
3. Framework Preset이 **Express**(또는 Other)로 잡히면 Build Command·Output Directory는 비워 둡니다.
4. **Environment Variables**에 세 개를 넣습니다. `.env`와 같은 값입니다. (`PORT`는 넣지 않음)

   | 이름 | 값 |
   | --- | --- |
   | `DATABASE_URL` | Supabase Transaction pooler 연결 문자열 (포트 6543) |
   | `STAFF_PIN` | 6자리 이상 PIN |
   | `AUTH_SECRET` | 3-2에서 만든 긴 문자열 |

5. **Deploy**를 누릅니다. 1~2분 뒤 `https://<프로젝트명>.vercel.app` 주소가 나옵니다.
6. 이후에는 GitHub `main`에 push할 때마다 자동으로 다시 배포됩니다. 환경 변수를 바꿨다면 **Deployments → Redeploy**를 눌러야 반영됩니다.

배포 후 화면에 "서버 오류가 발생했습니다"가 나오면 Vercel 프로젝트의 **Logs**에서 오류를 확인하세요. 대부분 환경 변수 누락(`DATABASE_URL`, `AUTH_SECRET`)이나 연결 문자열 오타입니다.

### 3-5. 배포 후 확인

- [ ] 추천 화면에서 남성·50대·선물용을 고르면 상품이 판매순으로 나온다
- [ ] 상담원 모드 PIN이 한 번에 켜지고, 새로고침·필터 변경 후에도 꺼지지 않는다
- [ ] 관리 화면에서 재고를 고치고 **다른 PC나 휴대폰**에서 새로고침하면 바뀐 값이 보인다
- [ ] 엑셀 양식을 내려받아 올리면 미리보기 후 반영된다
- [ ] PIN을 5번 틀리면 5분간 잠긴다
- [ ] "안내 문구 복사"의 링크가 `https://….vercel.app/shop.html?id=…` 로 나온다

## 4. 운영 시 주의

- **Supabase 무료 플랜 일시 정지:** 7일 동안 사용이 거의 없으면 프로젝트가 일시 정지되고, 그동안 사이트에서 오류가 납니다. Supabase 대시보드에서 **Resume**을 누르면 돌아옵니다(정지 후 90일 안에). 매일 쓰면 대개 문제없고, 확실히 하려면 Pro 플랜(유료)을 씁니다.
- **백업:** 관리 화면의 "양식 내려받기"로 상품 목록을 주기적으로 받아 두세요. Supabase 무료 플랜에는 자동 백업 복원 기능이 제한적입니다.
- **비밀값 노출 시:** `DATABASE_URL`이 유출되면 Supabase에서 DB 비밀번호를 재설정하고 Vercel 환경 변수를 바꾼 뒤 Redeploy 합니다.
- **새 상품 이미지:** Vercel에서는 서버에 파일을 올릴 수 없으므로 `public/images/`에 넣고 GitHub에 push해야 합니다. 관리 화면에서 직접 올리게 하려면 Supabase Storage 연동이 추가로 필요합니다(이번 범위 밖).
- **seed 주의:** `npm run seed`는 Supabase의 상품·판매 데이터를 모두 지우고 샘플로 바꿉니다. 운영 중에는 절대 실행하지 마세요.

## 참고 문서

- [Vercel: Express on Vercel](https://vercel.com/docs/frameworks/backend/express) — `express.static` 무시, `public/`은 CDN으로 제공
- [Supabase: Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres) — 서버리스는 Transaction pooler(6543), prepared statement 미지원
- [Supabase: Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing) — 무료 플랜 7일 비활성 시 일시 정지
