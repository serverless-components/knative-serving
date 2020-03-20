# knative-serving

Instantly create and update Knative services on top of your Kubernetes cluster with [Serverless Components](https://github.com/serverless/components).

&nbsp;

1. [Install](#1-install)
2. [Create](#2-create)
3. [Configure](#3-configure)
4. [Deploy](#4-deploy)

&nbsp;

### 1. Install

```console
$ npm install -g serverless
```

### 2. Create

Just create a `serverless.yml` file

```console
$ touch serverless.yml
```

Make sure that you have generated your [`Kubeconfig` file](https://rancher.com/docs/rancher/v2.x/en/cluster-admin/kubeconfig/) via `kubectl`.

### 3. Configure

```yml
# serverless.yml
org: acme
app: todo
name: todo-knative-serving

component: knative-serving@dev

inputs:
  kubeConfigPath: ../kubeconfig # default is `~/.kube/config`
  knativeGroup: serving.knative.dev # default is `serving.knative.dev`
  knativeVersion: v1alpha1 # default is `v1alpha1`
  registryAddress: 'https://container-registry.acme.com' # default is `'https://index.docker.io/v1'`
  namespace: 'default' # default is `'default'`
  name: my-knative-service
  repository: acme/some-func
  tag: latest
```

### 4. Deploy

```console
$ serverless
```

### New to Components?

Checkout the [Serverless Components](https://github.com/serverless/components) repo for more information.
