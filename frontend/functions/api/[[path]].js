export async function onRequest({ request }) {
  const url = new URL(request.url);

  url.hostname = "tellmemore-api-8788040300.us-central1.run.app";
  url.protocol = "https:";
  url.port = "";

  return fetch(new Request(url.toString(), request));
}
