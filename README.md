# Lab 4: Kubernetes

> **Docker Desktop vs minikube**
>
> This lab works with either tool, but networking behaves differently:
>
> - **Docker Desktop** shares the same Docker daemon as your Mac and routes `LoadBalancer` services to `localhost` automatically. No extra steps needed — `kubectl apply` and you can `curl localhost:<port>` immediately.
>
> - **minikube** runs Kubernetes inside its own Docker container with a separate network. Its node IP (e.g. `192.168.49.2`) is not your Mac's `localhost`, so services are not reachable at `localhost` by default. You must run `minikube tunnel` in a dedicated terminal to bridge the gap, and all externally-facing services must use `type: LoadBalancer` (not `NodePort`) for the tunnel to expose them at `127.0.0.1`.
>
> The choice is yours :)

## Overview

In this lab you will deploy a multi-service notes application to a local Kubernetes cluster. The system has three services running inside the cluster (an API, a stats microservice, and a Postgres database) plus a React frontend that runs locally on your machine. You will build the system up one resource type at a time — each part introduces a single Kubernetes concept and adds one piece to a running whole.

The application code and Dockerfiles are provided. Your job is to complete the Kubernetes manifest skeletons in the `k8s/` directory.

---

## Learning Objectives

By the end of this lab you will be able to:

1. Navigate a Kubernetes cluster using `kubectl`.
2. Run containers as Kubernetes Pods.
3. Expose services with the correct Service type — `LoadBalancer` for external access, `ClusterIP` for internal-only.
4. Separate application configuration using ConfigMaps and Secrets.
5. Persist data across pod restarts using a PersistentVolumeClaim.
6. Manage workloads with Deployments and observe automatic self-healing.
7. Auto-scale a Deployment under CPU load using a HorizontalPodAutoscaler.

---

## Prerequisites

You need a local Kubernetes cluster. Use one of:

**Docker Desktop** — Settings → Kubernetes → Enable Kubernetes → Apply & Restart

**minikube**
```bash
minikube start
```

Verify your cluster is ready:

```bash
kubectl cluster-info
kubectl get nodes
```

You should see one node with status `Ready`.

---

## The Application

Four services working together:

| Service         | Where        | Language    | Role                                                          |
|-----------------|--------------|-------------|---------------------------------------------------------------|
| `frontend`      | Your machine | React + Vite | Serves the UI — calls the gateway from the browser           |
| `gateway`       | Cluster      | Express.js  | Single external entry point — rate limits and proxies to api  |
| `api`           | Cluster      | Express.js  | Notes CRUD; proxies `/stats` requests to stats-service        |
| `stats-service` | Cluster      | Express.js  | Queries Postgres for aggregate statistics                     |
| `postgres`      | Cluster      | Postgres 16 | Stores notes                                                  |

**api endpoints:**

| Method | Path         | Description                                      |
|--------|--------------|--------------------------------------------------|
| GET    | `/`          | Service info — name, pod name, log level         |
| GET    | `/health`    | Health check — used for liveness/readiness probes |
| GET    | `/notes`     | List all notes                                   |
| POST   | `/notes`     | Create a note `{ "title": "...", "content": "..." }` |
| DELETE | `/notes/:id` | Delete a note                                    |
| GET    | `/stats`     | Proxies to stats-service and returns the result  |

**stats-service endpoints:**

| Method | Path      | Description                                         |
|--------|-----------|-----------------------------------------------------|
| GET    | `/health` | Health check                                        |
| GET    | `/stats`  | Returns `totalNotes`, `avgContentLength`, `oldestNote`, `newestNote` |

---

## Architecture

```
  Your Machine
  ┌──────────────────────────────────────────────┐
  │  Browser + frontend (npm run dev :5173)       │
  │         │                                     │
  │         │ JS fetch → http://localhost:3000    │
  └─────────┼─────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────── Kubernetes Cluster ──────────────────────────────┐
  │                                                                                  │
  │  ┌─────────────────────┐                                                        │
  │  │   gateway Service   │                                                        │
  │  │ (type: LoadBalancer │                                                        │
  │  │   localhost:3000)   │                                                        │
  │  └──────────┬──────────┘                                                        │
  │             │  rate limit + proxy                                                │
  │             ▼                                                                    │
  │  ┌─────────────────────┐        ┌──────────────────────────┐                   │
  │  │    api Service      │        │  stats-service Service   │                   │
  │  │  (type: ClusterIP)  │        │  (type: ClusterIP)       │                   │
  │  └──────────┬──────────┘        └───────────┬──────────────┘                   │
  │             │                               │                                    │
  │             ▼                               ▼                                    │
  │  ┌─────────────────────┐        ┌──────────────────────────┐                   │
  │  │     api Pod(s)      │───────►│   stats-service Pod      │                   │
  │  └──────────┬──────────┘        └──────────────────────────┘                   │
  │             │                                                                    │
  │             └───────►┌──────────────────────┐                                  │
  │                      │  postgres Service    │                                  │
  │                      │  (type: ClusterIP)   │                                  │
  │                      └──────────┬───────────┘                                  │
  │                                 ▼                                                │
  │                      ┌──────────────────────┐                                  │
  │                      │    postgres Pod      │                                  │
  │                      │    + PVC (Part 6)    │                                  │
  │                      └──────────────────────┘                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

### Service Type Summary

| Service         | Type         | Reachable from                    | Why                                                        |
|-----------------|--------------|-----------------------------------|------------------------------------------------------------|
| `gateway`       | LoadBalancer | Browser (`http://localhost:3000`) | Single external entry point — rate limits before forwarding |
| `api`           | ClusterIP    | Inside cluster only               | Only the gateway calls it — not exposed publicly (Part 9)  |
| `stats-service` | ClusterIP    | Inside cluster only               | Only `api` calls it — no reason to expose it publicly      |
| `postgres`      | ClusterIP    | Inside cluster only               | Only `api` and `stats-service` need it                     |

> **Note:** In Parts 1–8, `api` is a `LoadBalancer` so you can test it directly with `curl`. In Part 9 it is demoted to `ClusterIP` once the gateway takes over.

---

## Repository Structure

```
SWE4213-Lab4/
├── README.md
├── docker-compose.yml                  # reference — same system using Compose
├── load-test.sh                        # provided — used in Part 8
├── api/
│   ├── Dockerfile                      # provided
│   ├── package.json                    # provided
│   └── src/index.js                    # provided
├── gateway/
│   ├── Dockerfile                      # provided
│   ├── package.json                    # provided
│   └── src/index.js                    # provided
├── stats-service/
│   ├── Dockerfile                      # provided
│   ├── package.json                    # provided
│   └── src/index.js                    # provided
├── frontend/
│   ├── Dockerfile                      # provided
│   ├── index.html                      # provided
│   ├── vite.config.js                  # provided
│   └── src/
│       ├── main.jsx                    # provided
│       ├── App.jsx                     # provided
│       └── index.css                   # provided
└── k8s/
    ├── postgres-pod.yaml               # provided
    ├── 02-pod/
    │   ├── api-pod.yaml                # SKELETON
    │   └── stats-pod.yaml              # SKELETON
    ├── 03-service/
    │   ├── api-service.yaml            # SKELETON
    │   └── stats-service.yaml          # SKELETON
    ├── 04-configmap/
    │   ├── configmap.yaml              # SKELETON
    │   └── api-pod.yaml                # SKELETON
    ├── 05-secret/
    │   ├── postgres-secret.yaml        # provided
    │   ├── api-secret.yaml             # SKELETON
    │   ├── api-pod.yaml                # SKELETON
    │   └── stats-pod.yaml              # SKELETON
    ├── 06-volumes/
    │   ├── postgres-pvc.yaml           # provided
    │   └── postgres-deployment.yaml    # provided
    ├── 07-deployment/
    │   ├── api-deployment.yaml         # SKELETON
    │   └── stats-deployment.yaml       # SKELETON
    ├── 08-scaling/
    │   └── api-hpa.yaml                # SKELETON
    └── 09-gateway/
        ├── gateway-deployment.yaml     # SKELETON
        ├── gateway-service.yaml        # provided
        └── api-service.yaml            # SKELETON (demotes api to ClusterIP)
```

---

## Docker Compose vs Kubernetes

Before starting, open `docker-compose.yml` alongside the `k8s/` directory. They describe the exact same system.

| Concern                  | Docker Compose                         | Kubernetes                                         |
|--------------------------|----------------------------------------|----------------------------------------------------|
| Run a container          | `services.<name>.image`                | `Pod` → `spec.containers`                          |
| Internal service calls   | Container name DNS (`stats-service:4000`) | `ClusterIP` Service + same DNS convention        |
| Expose to host machine   | `ports: "3000:3000"`                   | `LoadBalancer` Service + `minikube tunnel`          |
| Internal-only service    | Omit `ports:` entirely                 | `ClusterIP` Service (no nodePort)                  |
| Non-sensitive config     | `environment:` inline                  | `ConfigMap` + `envFrom`                            |
| Sensitive config         | `environment:` inline (not great)      | `Secret` + `secretKeyRef`                          |
| Persistent storage       | Named `volumes:`                       | `PersistentVolumeClaim`                            |
| Self-healing             | `restart: always`                      | `Deployment` controller (automatic)                |
| Manual scaling           | `docker compose scale`                 | `kubectl scale deployment`                         |
| Auto-scaling             | Not built-in                           | `HorizontalPodAutoscaler`                          |
| Rolling updates          | Not built-in                           | `kubectl rollout` — zero downtime by default       |

Notice that `stats-service` in `docker-compose.yml` has no `ports:` mapping. The same pattern appears in Kubernetes as a `ClusterIP` Service — reachable inside the cluster but not from outside. This is a deliberate security and architecture decision: services that have no business being public should not be exposed.

---

## Part 1 — Cluster & Nodes

A Kubernetes **cluster** consists of a **control plane** (schedules workloads, maintains desired state) and one or more **worker nodes** (run the containers). In Docker Desktop and minikube, a single machine plays both roles.

**Start the frontend locally** — it runs on your machine and calls the api at `http://localhost:3000`:

```bash
cd frontend
npm install
npm run dev
```

Leave this running. The UI will be available at `http://localhost:5173`.

**Build the cluster images** before doing anything else.

> **minikube users — read this first.** minikube runs its own Docker daemon, separate from your Mac's Docker. Images built with a plain `docker build` go into the host daemon and are invisible to minikube. You must point your shell at minikube's daemon before building:
> ```bash
> eval $(minikube docker-env)
> ```
> This only affects the current terminal session. Run it again in any new terminal before building or rebuilding images.

**Docker Desktop users:** no extra step needed — Kubernetes shares the same Docker daemon.

```bash
# minikube users: run eval $(minikube docker-env) first
docker build -t api:latest ./api
docker build -t stats-service:latest ./stats-service
```

> **Important:** The manifests use `imagePullPolicy: Never`. This tells Kubernetes to use local images instead of pulling from Docker Hub. If you see `ErrImageNeverPull`, you either forgot `eval $(minikube docker-env)` before building, or you need to rebuild after opening a new terminal.

Explore your cluster:

```bash
kubectl cluster-info                   # control plane URL
kubectl get nodes                      # list nodes
kubectl get nodes -o wide              # show OS, container runtime, IP
kubectl describe node <node-name>      # capacity, conditions, running pods
```

Enable the metrics server — required for Part 8:

**minikube:**
```bash
minikube addons enable metrics-server
```

**Docker Desktop:**

Docker Desktop does not bundle a metrics server, so you need to install one. The default install often fails TLS verification against the kubelet — patch it with `--kubelet-insecure-tls` to fix this:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

kubectl patch deployment metrics-server -n kube-system \
  --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

Wait about 60 seconds, then verify:

```bash
kubectl top nodes
```

You should see CPU and memory figures. If it still errors, wait another minute and retry — the metrics server takes a moment to collect its first sample.

---

## Part 2 — Pods

A **Pod** is the smallest deployable unit in Kubernetes. It wraps one or more containers and gives them a shared network namespace.

Before deploying the application services, start Postgres. This is fully provided — apply it and move on:

```bash
# The postgres pod reads credentials from this Secret — apply it first.
kubectl apply -f k8s/05-secret/postgres-secret.yaml

# Bare postgres Pod + ClusterIP Service.
kubectl apply -f k8s/postgres-pod.yaml

# Watch until postgres shows Running, then Ctrl+C.
kubectl get pods -w
```

Now open `k8s/02-pod/api-pod.yaml` and `k8s/02-pod/stats-pod.yaml`. Fill in every `???` in both files. The inline comments explain each field.

Apply and verify:

```bash
kubectl apply -f k8s/02-pod/api-pod.yaml
kubectl apply -f k8s/02-pod/stats-pod.yaml
kubectl get pods
kubectl logs api
kubectl logs stats-service
```

Both pods should show `listening on port ...` in their logs.

> **How do the pods reach Postgres?** When you applied `postgres-pod.yaml` it created a Service named `postgres`. Kubernetes runs an internal DNS server (CoreDNS) — any pod can resolve `postgres` to the ClusterIP of that Service. The connection string `postgresql://postgres:secret@postgres:5432/notesdb` works because `postgres` resolves correctly inside the cluster.

**The catch with bare Pods:**

```bash
kubectl delete pod api
kubectl get pods
```

The pod is gone and nothing replaces it. You will fix this in Part 7. Recreate it before continuing:

```bash
kubectl apply -f k8s/02-pod/api-pod.yaml
```

**Useful debugging commands:**

```bash
kubectl describe pod api          # events, env vars, status — first place to check on failure
kubectl logs api                  # stdout from the container
kubectl exec -it api -- sh        # open a shell inside the running container
```

---

## Part 3 — Services

Pods have internal IP addresses reachable only from inside the cluster. A **Service** gives a pod (or group of pods) a stable network endpoint. The Service type determines who can reach it.

You have two services to create this part — and they need different types:

**api-service.yaml** — the API must be reachable from your browser (for `curl` and for the frontend).

Open `k8s/03-service/api-service.yaml` and fill in every `???`. Use `LoadBalancer` as the type.

```bash
kubectl apply -f k8s/03-service/api-service.yaml
kubectl get services
```

**Accessing services from your machine**

**minikube on macOS:** minikube runs inside a Docker container with its own network. The Kubernetes node IP is something like `192.168.49.2` — not your Mac's `localhost`. This means `NodePort` services are exposed on *that node IP*, not on `127.0.0.1`, so `curl http://localhost:<nodePort>` will fail.

Using `type: LoadBalancer` plus `minikube tunnel` solves this. The tunnel creates a network route from your Mac into the minikube network and assigns `127.0.0.1` as the `EXTERNAL-IP` for every `LoadBalancer` service — making them reachable at a fixed `localhost:<port>`.

Run `minikube tunnel` in a dedicated terminal — it must stay open for the entire lab:

```bash
# Keep this running for the entire lab.
minikube tunnel
```

After starting the tunnel, `kubectl get services` should show `EXTERNAL-IP: 127.0.0.1` for the api service.

**Docker Desktop:** `LoadBalancer` services are already reachable at `localhost` — no extra step needed.

```bash
curl http://localhost:3000/
```

Test from your machine:

```bash
curl http://localhost:3000/
curl http://localhost:3000/health
curl http://localhost:3000/notes
```

Create a note:

```bash
curl -X POST http://localhost:3000/notes \
     -H "Content-Type: application/json" \
     -d '{"title":"hello","content":"my first note"}'
```

**stats-service.yaml** — stats-service should be reachable *only* from inside the cluster. Only the api calls it. There is no reason to expose it to your browser.

Open `k8s/03-service/stats-service.yaml` and fill in every `???`. Pay attention to the type.

```bash
kubectl apply -f k8s/03-service/stats-service.yaml
kubectl get services
```

You should see `stats-service` listed with type `ClusterIP` and no external port. Verify it is reachable from inside the api pod but NOT from your machine:

```bash
# Reachable from inside the cluster:
kubectl exec -it api -- sh
wget -qO- http://stats-service:4000/health
exit

# Not reachable from your machine (this should fail — that is correct behaviour):
curl http://stats-service:4000/stats
```

Now test the proxied stats endpoint through the api:

```bash
curl http://localhost:3000/stats
```

The api calls `stats-service:4000/stats` internally and returns the result.

> **Why use ClusterIP for stats-service?** Exposing a service publicly when it does not need to be public increases your attack surface. The `stats-service` has no authentication — if it were on a NodePort, anyone on the network could query your database statistics. ClusterIP keeps it internal by design.

---

## Part 4 — ConfigMaps

Configuration values are currently hardcoded in the Pod manifests. A **ConfigMap** stores non-sensitive configuration as key-value pairs, separate from the container spec. This means you can change config without rebuilding images.

Open `k8s/04-configmap/configmap.yaml` and fill in the values. Note the `STATS_SERVICE_URL` key — this is the internal DNS name for the stats-service Service you created in Part 3.

Open `k8s/04-configmap/api-pod.yaml` and fill in the `???`. This version uses `envFrom` to inject all ConfigMap keys at once, replacing the individual `PORT` env var.

Apply:

```bash
kubectl apply -f k8s/04-configmap/configmap.yaml
kubectl delete pod api
kubectl apply -f k8s/04-configmap/api-pod.yaml
```

Verify `STATS_SERVICE_URL` was picked up:

```bash
curl http://localhost:3000/stats
```

The api now reads `STATS_SERVICE_URL` from the ConfigMap instead of having it hardcoded.

> The Service from Part 3 is still running — you do not need to reapply it. Services and Pods are independent resources.

---

## Part 5 — Secrets

`DATABASE_URL` is still hardcoded in the pod manifests with a username and password in plain text. **Secrets** work like ConfigMaps but are intended for sensitive values. The cluster handles them more carefully: `kubectl describe` does not print their values, and they are not unnecessarily written to disk on nodes.

> **On base64:** Secrets store values as base64-encoded strings. Base64 is encoding, not encryption — anyone with kubectl access and Secret read permissions can decode the values. Security comes from RBAC (controlling who can read Secrets). For this lab, base64 is sufficient.

Open `k8s/05-secret/postgres-secret.yaml` (provided). It uses `stringData` — Kubernetes converts plain-text values to base64 internally. It was already applied in Part 2.

Open `k8s/05-secret/api-secret.yaml`. This one uses `data`, which requires a base64-encoded value:

```bash
echo -n 'supersecret' | base64
```

Paste the output as the value for `API_KEY`, then apply:

```bash
kubectl apply -f k8s/05-secret/api-secret.yaml
```

Open `k8s/05-secret/api-pod.yaml` and `k8s/05-secret/stats-pod.yaml`. Fill in every `???` — these versions remove the hardcoded `DATABASE_URL` and reference secrets using `secretKeyRef`.

Apply:

```bash
kubectl delete pod api
kubectl delete pod stats-service
kubectl apply -f k8s/05-secret/api-pod.yaml
kubectl apply -f k8s/05-secret/stats-pod.yaml
kubectl logs api
kubectl logs stats-service
```

Both services should start cleanly. Nothing changes from the outside — but credentials are no longer in any manifest file.

---

## Part 6 — Volumes

Kubernetes Pods are ephemeral — data written to a container's filesystem is lost when the pod is deleted. This is a problem for databases.

**Show the problem:**

```bash
curl -X POST http://localhost:3000/notes \
     -H "Content-Type: application/json" \
     -d '{"title":"important","content":"do not lose this"}'

kubectl delete pod postgres
kubectl apply -f k8s/postgres-pod.yaml
kubectl get pods -w   # wait for Running
```

```bash
curl http://localhost:3000/notes   # data is gone
```

**The fix — PersistentVolumeClaims:**

A `PersistentVolumeClaim` (PVC) requests persistent storage from the cluster. Data written to a PVC lives outside the container filesystem and survives pod replacements.

Read `k8s/06-volumes/postgres-pvc.yaml` and `k8s/06-volumes/postgres-deployment.yaml` before applying — locate the `volumes` and `volumeMounts` sections in the Deployment and understand how the PVC is attached.

Apply:

```bash
kubectl delete pod postgres --ignore-not-found
kubectl apply -f k8s/06-volumes/postgres-pvc.yaml
kubectl apply -f k8s/06-volumes/postgres-deployment.yaml
kubectl get pods -w
```

Verify persistence:

```bash
curl -X POST http://localhost:3000/notes \
     -H "Content-Type: application/json" \
     -d '{"title":"important","content":"this should survive"}'

# Delete the postgres pod — the Deployment controller replaces it.
kubectl delete pod -l app=postgres
kubectl get pods -w

curl http://localhost:3000/notes   # note is still there
```

---

## Part 7 — Deployments

You have been running application services as bare Pods. A **Deployment** wraps your Pod spec in a controller that:

- Maintains the desired number of running replicas
- Automatically replaces pods that are deleted or crash
- Performs rolling updates without downtime
- Waits for readiness probes before sending traffic to new pods

You have two Deployments to write this part: `api` and `stats-service`. The frontend runs locally on your machine — no Deployment needed for it.

> **Why not deploy the frontend in the cluster?** Frontends are commonly served from a CDN (e.g. Vercel, Netlify, CloudFront) — the built static files are distributed globally without touching your Kubernetes cluster. Running it locally with `npm run dev` mirrors this separation: the cluster handles API traffic only.

**api-deployment.yaml** — open `k8s/07-deployment/api-deployment.yaml` and fill in every `???`. Pay attention to `livenessProbe`, `readinessProbe`, and the `strategy` fields — the comments explain each one.

**stats-deployment.yaml** — open `k8s/07-deployment/stats-deployment.yaml` and fill in every `???`. The pattern is identical to `api-deployment.yaml`.

Remove the bare pods and apply the Deployments:

```bash
kubectl delete pod api stats-service --ignore-not-found

kubectl apply -f k8s/07-deployment/api-deployment.yaml
kubectl apply -f k8s/07-deployment/stats-deployment.yaml

kubectl get deployments
kubectl get pods
kubectl rollout status deployment/api
```

Open `http://localhost:5173` in a browser (your local frontend). Create a note and click **Refresh Stats**.

**Self-healing demo:**

Open a second terminal:

```bash
kubectl get pods -w
```

In your first terminal, delete one of the api pods:

```bash
kubectl delete pod <api-pod-name>
```

Watch the second terminal — a replacement pod is created immediately. The UI keeps working throughout.

**Scaling:**

```bash
kubectl scale deployment api --replicas=3
kubectl get pods
```

Hit `GET /` several times and notice the `pod` field changing — requests are load-balanced across all three replicas:

```bash
curl http://localhost:3000/
curl http://localhost:3000/
curl http://localhost:3000/
```

Scale back to 1 before Part 8:

```bash
kubectl scale deployment api --replicas=1
```

**Rolling update:**

Edit `k8s/04-configmap/configmap.yaml` — change `LOG_LEVEL` to `debug`. Apply it and restart the Deployment:

```bash
kubectl apply -f k8s/04-configmap/configmap.yaml
kubectl rollout restart deployment/api
kubectl rollout status deployment/api
```

Kubernetes brings up a new pod before terminating the old one — no requests are dropped.

---

## Part 8 — Self-Healing & Auto-Scaling

A **HorizontalPodAutoscaler** (HPA) watches CPU usage across the pods of a Deployment and automatically adjusts the replica count to keep average utilisation near a target.

Open `k8s/08-scaling/api-hpa.yaml` and fill in every `???`.

Apply:

```bash
kubectl apply -f k8s/08-scaling/api-hpa.yaml
kubectl get hpa
```

CPU will show `<unknown>` for about 60 seconds while the metrics server collects its first sample. Wait for a real percentage before continuing.

**Run the load test:**

Open two additional terminals so you can watch everything at once:

```bash
# Terminal 2
kubectl get pods -w
```

```bash
# Terminal 3
kubectl get hpa -w
```

In your first terminal, run the load test:

```bash
chmod +x load-test.sh
./load-test.sh http://localhost:3000
```

Within 1–2 minutes you should see:
- CPU climbing well above the target in `kubectl get hpa`
- New api pods appearing in `kubectl get pods -w`
- The notes UI continuing to work throughout

**Self-healing under load:**

While the load test is running, delete one of the api pods:

```bash
kubectl delete pod <api-pod-name>
```

The Deployment controller replaces it immediately. The load test continues without interruption because the remaining replicas keep handling traffic.

**Scale-down:**

After the load test finishes, watch `kubectl get hpa -w`. Once CPU drops below the target, the HPA gradually reduces the replica count back to `minReplicas`. Kubernetes waits several minutes before scaling down to confirm the load has actually subsided.

---

## Part 9 — API Gateway

So far the api Service has been a `LoadBalancer` — directly reachable from outside the cluster. In production this is rarely ideal. You want a single controlled entry point that can enforce rate limiting, authentication, and routing before traffic ever reaches your application services.

In this part you will deploy a lightweight **gateway** service that:
- Accepts all inbound traffic at `localhost:3000`
- Rate-limits requests per IP (100 requests per minute)
- Proxies valid requests through to the api
- Demotes the api Service to `ClusterIP` — it is no longer reachable from outside the cluster at all

**Build the gateway image:**

```bash
# minikube users: eval $(minikube docker-env) first
docker build -t gateway:latest ./gateway
```

**Demote the api Service to ClusterIP:**

```bash
kubectl apply -f k8s/09-gateway/api-service.yaml
```

After applying, `kubectl get svc api` should show `TYPE: ClusterIP`. Try curling it directly — it will no longer respond:

```bash
curl http://localhost:3000/health   # should fail — api is now internal only
```

**Deploy the gateway:**

Open `k8s/09-gateway/gateway-deployment.yaml` and fill in the `API_URL` — this is the internal DNS name for the api Service (same format as `STATS_SERVICE_URL` from Part 4).

```bash
kubectl apply -f k8s/09-gateway/gateway-deployment.yaml
kubectl apply -f k8s/09-gateway/gateway-service.yaml
kubectl rollout status deployment/gateway
```

The gateway is now the `LoadBalancer` at `localhost:3000`. The frontend requires no changes.

**Verify:**

```bash
curl http://localhost:3000/health       # proxied through gateway → api
curl http://localhost:3000/notes
```

**Test rate limiting:**

```bash
for i in $(seq 1 110); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health; done
```

After 100 requests within a minute you should start seeing `429` responses.

**Updated architecture:**

```
  Your Machine
  ┌──────────────────────────────────────────────┐
  │  Browser + frontend (npm run dev :5173)       │
  │         │                                     │
  │         │ JS fetch → http://localhost:3000    │
  └─────────┼─────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────── Kubernetes Cluster ──────────────────────────────┐
  │                                                                                  │
  │  ┌─────────────────────┐                                                        │
  │  │   gateway Service   │                                                        │
  │  │ (type: LoadBalancer │                                                        │
  │  │   localhost:3000)   │                                                        │
  │  └──────────┬──────────┘                                                        │
  │             │  rate limit + proxy                                                │
  │             ▼                                                                    │
  │  ┌─────────────────────┐        ┌──────────────────────────┐                   │
  │  │    api Service      │        │  stats-service Service   │                   │
  │  │  (type: ClusterIP)  │        │  (type: ClusterIP)       │                   │
  │  └──────────┬──────────┘        └───────────┬──────────────┘                   │
  │             │                               │                                    │
  │             ▼                               ▼                                    │
  │  ┌─────────────────────┐        ┌──────────────────────────┐                   │
  │  │     api Pod(s)      │───────►│   stats-service Pod      │                   │
  │  └──────────┬──────────┘        └──────────────────────────┘                   │
  │             │                                                                    │
  │             └───────►┌──────────────────────┐                                  │
  │                      │  postgres Service    │                                  │
  │                      │  (type: ClusterIP)   │                                  │
  │                      └──────────┬───────────┘                                  │
  │                                 ▼                                                │
  │                      ┌──────────────────────┐                                  │
  │                      │    postgres Pod      │                                  │
  │                      └──────────────────────┘                                  │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Deliverables

Submit your repository (zip or GitHub link) containing:

- [ ] `k8s/02-pod/api-pod.yaml` — completed
- [ ] `k8s/02-pod/stats-pod.yaml` — completed
- [ ] `k8s/03-service/api-service.yaml` — completed (LoadBalancer)
- [ ] `k8s/03-service/stats-service.yaml` — completed (ClusterIP)
- [ ] `k8s/04-configmap/configmap.yaml` — completed
- [ ] `k8s/04-configmap/api-pod.yaml` — completed
- [ ] `k8s/05-secret/api-secret.yaml` — completed
- [ ] `k8s/05-secret/api-pod.yaml` — completed
- [ ] `k8s/05-secret/stats-pod.yaml` — completed
- [ ] `k8s/07-deployment/api-deployment.yaml` — completed
- [ ] `k8s/07-deployment/stats-deployment.yaml` — completed
- [ ] `k8s/09-gateway/gateway-deployment.yaml` — completed
- [ ] `k8s/09-gateway/api-service.yaml` — completed
- [ ] `k8s/08-scaling/api-hpa.yaml` — completed
- [ ] Screenshot: `kubectl get pods` with all pods `Running`
- [ ] Screenshot: `kubectl get hpa` during the load test showing pods scaling up

---

## Grading Rubric

| Criteria                                                                                       | Marks |
|------------------------------------------------------------------------------------------------|-------|
| Both Pods start and the api responds at `http://localhost:3000`                                | 1     |
| `api-service.yaml` — LoadBalancer correct; `stats-service.yaml` — ClusterIP, no external port | 1     |
| `configmap.yaml` — `STATS_SERVICE_URL` set correctly; consumed via `envFrom` in api pod       | 1     |
| `api-secret.yaml` — API key stored as Secret; both pods use `secretKeyRef` for `DATABASE_URL` | 1     |
| Postgres PVC — data survives a pod deletion                                                    | 1     |
| Both Deployments apply cleanly; liveness and readiness probes defined on api and stats         | 1     |
| Self-healing — deleted pod is automatically replaced (screenshot)                              | 1     |
| `api-hpa.yaml` — pods scale up under load (screenshot of `kubectl get hpa`)                   | 1     |
| Gateway deployed; api demoted to ClusterIP; rate limiting returns 429 after 100 requests      | 1     |
| **Total**                                                                                      | **/9** |
