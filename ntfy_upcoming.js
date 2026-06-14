// SMH upcoming 알림 비활성화 파일
// 파일은 남겨두되, GitHub Actions에서 실행돼도 아무 알림도 보내지 않음.

async function main() {
  console.log("upcoming 알림은 현재 비활성화 상태입니다. 아무 작업도 하지 않습니다.");
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
