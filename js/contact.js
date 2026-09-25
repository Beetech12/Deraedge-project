(() => {
  const interests = [
    "Foundation Program",
    "Professional Program",
    "Mastery Program",
    "Strategic Partnership",
    "General Enquiry",
  ];
  let interest = interests[0];
  const row = document.getElementById("interest-row");
  interests.forEach((v) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (v === interest ? " active" : "");
    b.textContent = v;
    b.setAttribute("aria-pressed", String(v === interest));
    b.addEventListener("click", () => {
      interest = v;
      row
        .querySelectorAll(".chip")
        .forEach((c) => { c.classList.toggle("active", c === b); c.setAttribute("aria-pressed", String(c === b)); });
    });
    row.appendChild(b);
  });

  DeraForms.bind(document.getElementById("contact-form"), () => ({ Interest: interest }));
})();
