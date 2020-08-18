const kubernetes = require('@kubernetes/client-node')
const { Component } = require('@serverless/core')

const defaults = {
  knativeGroup: 'serving.knative.dev',
  knativeVersion: 'v1alpha1',
  registryAddress: 'docker.io',
  namespace: 'default'
}

class KnativeServing extends Component {
  async deploy(inputs = {}) {
    const config = {
      ...defaults,
      ...inputs
    }

    const k8sCustom = this.getKubernetesClient(kubernetes.CustomObjectsApi)

    let serviceExists = true
    try {
      await this.getService(k8sCustom, config)
    } catch (error) {
      console.dir(error)
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

    this.state = config
    return this.state
  }

  async remove(inputs = {}) {
    const config = {
      ...defaults,
      ...inputs,
      ...this.state
    }

    const k8sCustom = this.getKubernetesClient(kubernetes.CustomObjectsApi)

    let params = Object.assign({}, config)
    const manifest = this.getManifest(params)
    params = Object.assign(params, { manifest })
    await this.deleteService(k8sCustom, params)

    this.state = {}
    return {}
  }

  // "private" methods
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

  getKubernetesClient(type) {
    const { endpoint, port } = this.credentials.kubernetes
    const token = this.credentials.kubernetes.serviceAccountToken
    const skipTLSVerify = this.credentials.kubernetes.skipTlsVerify == 'true'
    const kc = new kubernetes.KubeConfig()
    kc.loadFromOptions({
      clusters: [
        {
          name: 'cluster',
          skipTLSVerify,
          server: `${endpoint}:${port}`
        }
      ],
      users: [{ name: 'user', token }],
      contexts: [
        {
          name: 'context',
          user: 'user',
          cluster: 'cluster'
        }
      ],
      currentContext: 'context'
    })
    return kc.makeApiClient(type)
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
    return {
      apiVersion: `${svc.knativeGroup}/${svc.knativeVersion}`,
      kind: 'Service',
      metadata: {
        name: svc.name,
        namespace: svc.namespace
      },
      spec: {
        template: {
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
