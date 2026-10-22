interface Env { ASSETS: { fetch(req: Request): Promise<Response> } }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'murdertrain.nixfred.com') {
      return Response.redirect('https://murder.nixfred.com' + url.pathname + url.search, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
