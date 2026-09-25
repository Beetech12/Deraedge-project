async function loadComponent(id, file) {
  const element = document.getElementById(id);

  const response = await fetch(file);
  const content = await response.text();

  element.innerHTML = content;
}

async function loadAllComponents() {
  await loadComponent(
    "header-placeholder",
    "/components/header.html"
  );

  await loadComponent(
    "footer-placeholder",
    "/components/footer.html"
  );

  document.dispatchEvent(new Event("componentsLoaded"));
}

loadAllComponents();