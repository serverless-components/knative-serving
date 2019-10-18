const path = require('path')
const { isEmpty, mergeDeepRight } = require('ramda')
const kubernetes = require('@kubernetes/client-node')
const { Component } = require('@serverless/core')

const defaults = {
  kubeConfigPath: path.join(process.env.HOME, '.kube', 'config'),
  knativeGroup: 'serving.knative.dev',
  knativeVersion: 'v1alpha1',
  registryAddress: 'docker.io',
  namespace: 'default'
}

class KnativeServing extends Component {
  async default(inputs = {}) {
    const config = mergeDeepRight(defaults, inputs)

    const k8sCore = this.getKubernetesClient(config.kubeConfigPath, kubernetes.CoreV1Api)
    const k8sCustom = this.getKubernetesClient(config.kubeConfigPath, kubernetes.CustomObjectsApi)

    let serviceExists = true
    try {
      await this.getService(k8sCustom, config)
    } catch (error) {
      serviceExists = error.body.code === 404 ? false : true
    }

    let params = Object.assign({}, config)
    const manifest = this.getManifest(params)
    params = Object.assign(params, { manifest })
    if (serviceExists) {
      await this.patchService(k8sCustom, params)
    } else {
      await this.createService(k8sCustom, params)
    }

    const ip = await this.getIstioIngressIp(k8sCore)
    config.istioIngressIp = ip

    this.state = config
    await this.save()
    return this.state
  }

  async remove(inputs = {}) {
    let config = mergeDeepRight(defaults, inputs)
    if (isEmpty(config)) {
      config = this.state
    }

    const k8sCustom = this.getKubernetesClient(config.kubeConfigPath, kubernetes.CustomObjectsApi)

    let params = Object.assign({}, config)
    const manifest = this.getManifest(params)
    params = Object.assign(params, { manifest })
    await this.deleteService(k8sCustom, params)

    this.state = {}
    await this.save()
    return {}
  }

  async info(inputs = {}) {
    const config = mergeDeepRight(defaults, inputs)

    const k8sCore = this.getKubernetesClient(config.kubeConfigPath, kubernetes.CoreV1Api)
    const ip = await this.getIstioIngressIp(k8sCore)
    config.istioIngressIp = ip

    this.state = config
    await this.save()
    return this.state
  }

  // "private" methods
  async getIstioIngressIp(k8s) {
    const res = await k8s.readNamespacedService('istio-ingressgateway', 'istio-system')
    return res.body.status.loadBalancer.ingress[0].ip
  }

  getKubernetesClient(configPath, type) {
    let kc = new kubernetes.KubeConfig()
    kc.loadFromFile(configPath)
    kc = kc.makeApiClient(type)
    return kc
  }

  getManifest({ knativeGroup, knativeVersion, name, namespace, registryAddress, repository, tag }) {
    return {
      apiVersion: `${knativeGroup}/${knativeVersion}`,
      kind: 'Service',
      metadata: {
        name,
        namespace
      },
      spec: {
        template: {
          spec: {
            containers: [
              {
                image: `${registryAddress}/${repository}:${tag}`
              }
            ]
          }
        }
      }
    }
  }

  async createService(k8s, { knativeGroup, knativeVersion, namespace, manifest }) {
    return k8s.createNamespacedCustomObject(
      knativeGroup,
      knativeVersion,
      namespace,
      'services',
      manifest
    )
  }

  async getService(k8s, { knativeGroup, knativeVersion, namespace, name }) {
    return k8s.getNamespacedCustomObject(knativeGroup, knativeVersion, namespace, 'services', name)
  }

  async patchService(k8s, { knativeGroup, knativeVersion, namespace, name, manifest }) {
    return k8s.patchNamespacedCustomObject(
      knativeGroup,
      knativeVersion,
      namespace,
      'services',
      name,
      manifest,
      {
        headers: { 'Content-Type': 'application/merge-patch+json' }
      }
    )
  }

  async deleteService(k8s, { knativeGroup, knativeVersion, namespace, name }) {
    return k8s.deleteNamespacedCustomObject(
      knativeGroup,
      knativeVersion,
      namespace,
      'services',
      name,
      {
        apiVersion: `${knativeGroup}/${knativeVersion}`
      }
    )
  }
}

module.exports = KnativeServing
