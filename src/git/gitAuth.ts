// Lets git fetch a private GitHub repo with the token from VS Code's login. The token goes into
// environment variables, not into the command line, where other users could see it in `ps`.
export function gitAuthEnvironment(cloneUrl: string, token: string): NodeJS.ProcessEnv {
  if (!cloneUrl.startsWith("https://")) {
    return {};
  }
  const origin = new URL(cloneUrl).origin;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}
