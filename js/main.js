document.addEventListener("componentsLoaded", () => {
  // Header shrink on scroll
  const header = document.getElementById("header");

  const onScroll = () => {
    header.classList.toggle("scrolled", window.scrollY > 24);
  };

  onScroll();

  window.addEventListener("scroll", onScroll, {
    passive: true,
  });

  // Scroll reveal
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  document
    .querySelectorAll(".reveal")
    .forEach((el) => io.observe(el));
});
// Header shrink on scroll
// const header = document.getElementById("header");
//       const onScroll = () =>
//         header.classList.toggle("scrolled", window.scrollY > 24);
//       onScroll();
//       window.addEventListener("scroll", onScroll, { passive: true });

//       // Scroll reveal
//       const io = new IntersectionObserver(
//         (entries) => {
//           entries.forEach((e) => {
//             if (e.isIntersecting) {
//               e.target.classList.add("is-visible");
//               io.unobserve(e.target);
//             }
//           });
//         },
//         { threshold: 0.15 },
//       );
//       document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
