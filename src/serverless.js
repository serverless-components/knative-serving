const path = require('path')
const { isEmpty, mergeDeepRight } = require('ramda')
const kubernetes = require('@kubernetes/client-node')
const { Component } = require('@serverless/core')

const defaults = {
  kubeConfigPath: path.join(process.env.HOME, '.kube', 'config'),
  knativeGroup: 'serving.knative.dev',
  knativeVersion: 'v1',
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

    const serviceUrl = await this.getServiceUrl(k8sCustom, config)
    config.serviceUrl = serviceUrl

    const istioIngressIp = await this.getIstioIngressIp(k8sCore)
    config.istioIngressIp = istioIngressIp

    this.state = config
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
    const k8sCustom = this.getKubernetesClient(config.kubeConfigPath, kubernetes.CustomObjectsApi)
    const serviceUrls = await this.getServiceUrls(k8sCustom, config)
    config.serviceUrls = serviceUrls

    const istioIngressIp = await this.getIstioIngressIp(k8sCore)
    config.istioIngressIp = istioIngressIp

    this.state = config
    await this.save()
    return this.state
  }

  // "private" methods
  async getIstioIngressIp(k8s) {
    const res = await k8s.readNamespacedService('istio-ingressgateway', 'istio-system')
    if (res.body && res.body.status.loadBalancer && res.body.status.loadBalancer.ingress) {
      return res.body.status.loadBalancer.ingress[0].ip
    }
  }

  async getServiceUrl(k8s, config) {
    let url
    do {
      const service = await this.getService(k8s, config)
      if (service.body.status && service.body.status.url) {
        url = service.body.status.url // eslint-disable-line prefer-destructuring
      }
      await new Promise((resolve) => setTimeout(() => resolve(), 2000))
    } while (!url)
    return url
  }

  async getServiceUrls(k8s, config) {
    let urls = new Map()
    do {
      const services = await this.listServices(k8s, config)
      if (services.response.statusCode == 200 && services.body.items) {
        services.body.items.forEach( s => {
          const serviceName = s.metadata.name
          const serviceUrl = s.status.url
          urls.set(serviceName, serviceUrl)
        })
      }
      await new Promise((resolve) => setTimeout(() => resolve(), 2000))
    } while (!urls)
    return urls
  }

  getKubernetesClient(configPath, type) {
    let kc = new kubernetes.KubeConfig()
    kc.loadFromFile(configPath)
    kc = kc.makeApiClient(type)
    return kc
  }

  getManifest(svc) {
    const imageConfig = {}
    if (svc.digest) {
      imageConfig.image = `${svc.registryAddress}/${svc.repository}@${svc.digest}`
    } else if (svc.tag) {
      imageConfig.image = `${svc.registryAddress}/${svc.repository}:${svc.tag}`
    } else {
      imageConfig.image = `${svc.registryAddress}/${svc.repository}:latest`
    }
    if (svc.pullPolicy) {
      imageConfig.imagePullPolicy = svc.pullPolicy
    }

    const annotations = {}
    if (svc.autoscaler) {
      for (const key in svc.autoscaler) {
        const value = (typeof svc.autoscaler[key] == 'number') ? svc.autoscaler[key].toString() : svc.autoscaler[key]
        annotations[`autoscaling.knative.dev/${key}`] = value
      }
    }
    return {
      apiVersion: `${svc.knativeGroup}/${svc.knativeVersion}`,
      kind: 'Service',
      metadata: {
        name: svc.name,
        namespace: svc.namespace
      },
      spec: {
        template: {
          metadata: {
            annotations
          },
          spec: {
            containers: [
              imageConfig
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

  async listServices(k8s, { knativeGroup, knativeVersion, namespace }) {
    return k8s.listNamespacedCustomObject(knativeGroup, knativeVersion, namespace, 'services')
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
