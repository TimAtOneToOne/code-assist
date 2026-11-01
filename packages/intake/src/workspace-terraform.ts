type GuestCommand = (args: string[]) => Promise<unknown>;

// Keep version selection in tfenv; repository pins and TFENV_TERRAFORM_VERSION
// take precedence over the initial guest default.
export const terraformSetup = `
set -eu
if ! test -x /home/workspace/.tfenv/bin/tfenv; then
  git clone --branch v3.2.2 --depth 1 https://github.com/tfutils/tfenv.git /home/workspace/.tfenv
  chown -R workspace:workspace /home/workspace/.tfenv
fi
test "$(git -c safe.directory=/home/workspace/.tfenv -C /home/workspace/.tfenv rev-parse HEAD)" = de6ce2e809c155cbc5e2cfeb3b1bef151244e045
ln -sfn /home/workspace/.tfenv/bin/tfenv /usr/local/bin/tfenv
if ! test -e /usr/local/bin/terraform; then
  ln -s /home/workspace/.tfenv/bin/terraform /usr/local/bin/terraform
fi
`;

export async function ensureGuestTerraform(
  root: GuestCommand,
  guest: GuestCommand,
) {
  await root(["bash", "-euc", terraformSetup]);
  await guest([
    "bash",
    "-euc",
    "cd /home/workspace; if ! test -f .tfenv/version; then tfenv install 1.14.8; tfenv use 1.14.8; fi; terraform version",
  ]);
}
