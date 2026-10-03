let count = 0;
const timer = setInterval(() => {
  count += 1;
  console.log(`tick ${count}`);
  if (count >= 5) {
    clearInterval(timer);
  }
}, 60);
