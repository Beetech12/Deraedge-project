(() => {
  const capacities = [
    "Individual / Principal",
    "Family Office",
    "Company",
    "Institution",
    "Technology / Infrastructure Partner",
    "Research / Intelligence Partner",
    "Other",
  ];
  const contributions = [
    "Strategic Capital",
    "Market Intelligence",
    "Technology",
    "Institutional Access",
    "Commercial Opportunities",
    "Research / Expertise",
    "Other",
  ];
  let capacity = capacities[0],
    selected = [];

  function chipRow(el, items, isContribution) {
    items.forEach((v) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.className = "chip";
      b.textContent = v;
      if (isContribution) {
        b.innerHTML =
          '<svg class="tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>' +
          v;
      }
      b.addEventListener("click", () => {
        if (isContribution) {
          if (selected.includes(v)) {
            selected = selected.filter((x) => x !== v);
            b.classList.remove("active");
            b.setAttribute("aria-pressed", "false");
            b.querySelector(".tick").style.display = "none";
          } else if (selected.length >= 2) {
            DeraForms.showStatus(document.getElementById("partner-form"), "Select up to two contributions. Deselect one to choose another.");
          } else {
            selected.push(v);
            b.classList.add("active");
            b.setAttribute("aria-pressed", "true");
            b.querySelector(".tick").style.display = "block";
          }
        } else {
          capacity = v;
          el.querySelectorAll(".chip").forEach((c) =>
            { c.classList.toggle("active", c === b); c.setAttribute("aria-pressed", String(c === b)); },
          );
        }
      });
      el.appendChild(b);
    });
    if (!isContribution) { el.firstChild.classList.add("active"); el.firstChild.setAttribute("aria-pressed", "true"); }
  }
  chipRow(document.getElementById("capacity-row"), capacities, false);
  chipRow(document.getElementById("contribution-row"), contributions, true);


  DeraForms.bind(document.getElementById("partner-form"), () => ({
    Capacity: capacity, Contributions: selected.join(", ")
  }), () => {
    if (selected.length) return true;
    DeraForms.showStatus(document.getElementById("partner-form"), "Select at least one contribution area.");
    document.querySelector("#contribution-row button").focus();
    return false;
  });
})();
