import { containerDefaults } from "./workspace-environment.ts";

export const bootstrap = `
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y curl ca-certificates postgresql-client git make zip unzip
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<'SOURCE'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: arm64
Signed-By: /etc/apt/keyrings/docker.asc
SOURCE
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'CONFIG'
${JSON.stringify(containerDefaults)}
CONFIG
dockerd --validate --config-file=/etc/docker/daemon.json
systemctl enable docker
systemctl restart docker
id workspace >/dev/null 2>&1 || useradd --create-home --shell /bin/bash workspace
usermod -aG docker workspace
install -d -m 0700 -o workspace -g workspace /work
mkdir -p /tmp/code-assist-toolchain
cd /tmp/code-assist-toolchain
curl -fsSLO https://nodejs.org/dist/v24.22.0/node-v24.22.0-linux-arm64.tar.xz
curl -fsSLO https://nodejs.org/dist/v24.22.0/SHASUMS256.txt
grep ' node-v24.22.0-linux-arm64.tar.xz$' SHASUMS256.txt | sha256sum -c -
tar -xJf node-v24.22.0-linux-arm64.tar.xz -C /usr/local --strip-components=1
npm install -g pnpm@10.28.0
rm -rf /tmp/code-assist-toolchain
`;

// JSON preserves arbitrary mapped values without shell or dotenv interpolation.
export const environmentLauncher = `
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const argv=process.argv.slice(2);
const name=argv[0]==='--repo' ? (argv.splice(0,1),argv.shift()) : null;
const [command,...args]=argv;
const directories=JSON.parse(readFileSync('/work/repositories.json','utf8'));
if(name && !Object.hasOwn(directories,name))throw new Error('Unknown repository.');
if(!command)throw new Error('Supply a workspace command.');
const env=JSON.parse(readFileSync(name ? '/work/environments/'+name+'.json' : '/work/environment.json','utf8'));
const child=spawn(command,args,{cwd:name ? directories[name] : directories[Object.keys(directories)[0]],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/home/workspace',USER:'workspace',LANG:'C.UTF-8',...env},stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Workspace command could not start.');process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
`;
