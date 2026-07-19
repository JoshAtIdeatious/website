document.addEventListener('DOMContentLoaded', () => {
  const lamp = document.querySelector('.wordmark');
  let isOn = true;
  let flickerTimer;

  document.body.addEventListener('click', () => {
    if (isOn) {
      isOn = false;
      clearTimeout(flickerTimer);
      lamp.classList.remove('is-flickering');
      lamp.classList.add('is-off');
    } else {
      isOn = true;
      lamp.classList.remove('is-off');
      lamp.classList.add('is-flickering');
      clearTimeout(flickerTimer);
      flickerTimer = setTimeout(() => {
        lamp.classList.remove('is-flickering');
      }, 700);
    }
  });
});
