# Networking facts (paraphrased from public documentation)

Reference notes behind the question bank. Facts marked **[doc]** were checked against the linked public documentation page on 2026-11-22; facts marked **[std]** are standard networking facts (RFCs, cloud-vendor basics). Docs change, so verify against the current pages before relying on any of this.

### 1 General networking fundamentals [std]

**OSI / TCP-IP layers**
- The OSI model has 7 layers: 1 Physical, 2 Data Link (MAC, Ethernet, switches), 3 Network (IP, routers), 4 Transport (TCP/UDP, ports), 5 Session, 6 Presentation (TLS is often placed here or at 5), 7 Application (HTTP, DNS, SMTP).
- The TCP/IP model has 4 layers: Link, Internet, Transport, Application.
- An L4 load balancer routes on IP and port (AWS NLB, Azure Load Balancer). An L7 load balancer routes on HTTP host, path, or headers (AWS ALB, Azure Application Gateway).

**TCP vs UDP**
- TCP is connection-oriented: 3-way handshake (SYN → SYN-ACK → ACK), ordered and reliable delivery, retransmits.
- UDP is connectionless and has no delivery guarantee. It's used by DNS queries, streaming, and QUIC/HTTP3.
- A stateful firewall or security group automatically allows return traffic. A stateless one (AWS NACL) needs explicit rules for the return direction, including ephemeral ports 1024–65535.

**Well-known ports**
- 22 SSH, 53 DNS (UDP/TCP), 80 HTTP, 443 HTTPS, 3306 MySQL, 5432 PostgreSQL, 1433 SQL Server, 1521 Oracle, 9092 Kafka, 9093 Kafka over TLS (Event Hubs Kafka endpoint), 389/636 LDAP/LDAPS, 445 SMB, 2049 NFS, 111 RPC portmapper.

**CIDR and subnetting math**
- The usable address count in a /n block is 2^(32−n).
- Common sizes: /16 = 65,536, /20 = 4,096, /24 = 256, /25 = 128, /26 = 64, /27 = 32, /28 = 16.
- Cloud providers reserve addresses in every subnet. **AWS reserves 5 per subnet** (network, VPC router, DNS, future use, broadcast). **Azure also reserves 5.** GCP reserves 4 in the primary range.
- Each step down in prefix length doubles the size: a /17 holds two /18s.
- RFC 1918 private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. RFC 6598 carrier-grade NAT range: `100.64.0.0/10`.
- Non-overlapping CIDRs are required for peering, Transit Gateway, VPN, and hub-spoke designs.
- Worked example: a /26 has 64 − 5 = 59 usable IPs on AWS or Azure.

**Routing**
- A route table picks the **longest-prefix match**. `0.0.0.0/0` is the default route.
- On Azure, a **UDR** (user-defined route) overrides system routes, for example sending `0.0.0.0/0` to a firewall NVA. A next hop of "Internet" bypasses the NVA.
- **BGP** exchanges routes between on-prem and cloud over Direct Connect, ExpressRoute, or VPN.
- **VPC/VNet peering is non-transitive.** A hub-spoke design uses AWS Transit Gateway, Azure Virtual WAN, or a hub VNet with an NVA and UDRs.

**NAT**
- SNAT lets private hosts reach the internet through a shared public IP.
- AWS NAT Gateway sits in a public subnet and routes to an Internet Gateway. Azure NAT Gateway attaches to subnets. GCP uses Cloud NAT.
- A NAT gateway gives a **stable egress IP**, which you can put on a partner's allowlist.

**DNS**
- Record types: A/AAAA (name to IP), CNAME (alias), PTR (reverse lookup).
- Resolution path: recursive resolver → root → TLD → authoritative server. TTL controls caching.
- **Split-horizon / private DNS**: a private hosted zone (Route 53 private zone, Azure Private DNS zone, Cloud DNS private zone) answers with private-endpoint IPs inside the VPC, while public DNS still returns public IPs. This is the core mechanism behind Private Link.
- Hybrid DNS: on-prem resolvers forward to Route 53 Resolver inbound endpoints or Azure DNS Private Resolver. In Azure, `168.63.129.16` is the platform DNS / health-probe virtual IP.

**TLS**
- The handshake negotiates the cipher, the server presents its certificate chain, and the client validates it against a trusted CA and the hostname (SNI/SAN).
- mTLS means both sides present certificates. TLS 1.2 and 1.3 are current.
- A **TLS-inspecting proxy** (Zscaler, Palo Alto) re-signs traffic with a corporate CA. Clients and clusters then need that CA in their trust store, which is a common cause of `SSL: CERTIFICATE_VERIFY_FAILED` on Databricks clusters behind such proxies.

**Proxies**
- A forward proxy handles client egress, using `HTTP(S)_PROXY` and `NO_PROXY` settings. A reverse proxy sits in front of servers.
- Explicit vs transparent proxy: an explicit proxy is configured on the client, while a transparent proxy intercepts traffic in the network path.

**Firewalls**
- Security groups (AWS) and NSGs (Azure) are distributed, stateful L3/L4 filters.
- AWS Network ACLs are stateless and apply at the subnet level.
- Azure Firewall, AWS Network Firewall, and Palo Alto NVAs add FQDN filtering, TLS inspection, and IDS.
- Azure **service tags**, such as `AzureDatabricks`, `Storage`, `EventHub`, and `Sql`, are Microsoft-maintained IP groups used in NSG rules.

**Hybrid connectivity**
- **Site-to-site VPN**: IPsec over the internet, roughly up to 1.25 Gbps per AWS tunnel, cheaper but variable.
- Private dedicated circuits: **AWS Direct Connect**, **Azure ExpressRoute**, and **GCP Cloud Interconnect** (Dedicated or Partner). They give predictable latency and use BGP. ExpressRoute private peering reaches VNets. Microsoft peering reaches PaaS public endpoints.
- These links carry on-prem users to front-end Private Link endpoints and clusters to on-prem data sources.

**Private endpoints vs service endpoints**
- Azure **service endpoints**: traffic to the PaaS service rides the Azure backbone from a subnet, but the service still uses its public IP, and the subnet is allowed on the service's firewall.
- **Private endpoints (Private Link)**: a NIC with a private IP in your VNet maps to a specific resource, and private DNS is required.
- AWS has two endpoint types. A **gateway endpoint** (S3, DynamoDB) is a route-table entry and is free. An **interface endpoint** (PrivateLink) is an ENI that's billed per hour and per GB.

### 2 Databricks architecture: planes

- **Three connection points** in Databricks networking [doc]:
  1. Users and applications to Databricks: controlled with private connectivity, context-based ingress control, and IP access lists.
  2. Control plane and classic compute plane: classic compute runs in your own virtual network.
  3. Serverless compute plane and your resources: governed by egress controls, private connectivity, and firewall configuration.
  — https://docs.databricks.com/aws/en/security/network/
- The **control plane** is the set of backend services Databricks manages in its own cloud account: web app, REST APIs, job scheduler, cluster manager, notebooks, and so on.
- The **classic compute plane** runs in the customer's cloud account and VPC/VNet.
- The **serverless compute plane** runs in Databricks' cloud account. Control-plane-to-serverless traffic stays on the cloud backbone, not the public internet. [doc] https://docs.databricks.com/aws/en/security/network/serverless-network-security/
- The Azure docs list three Private Link types: **Inbound (front-end)** for users to workspaces and account resources, **Outbound (serverless)** for serverless compute to customer resources, and **Classic (back-end)** for classic compute to the control plane. [doc] https://learn.microsoft.com/en-us/azure/databricks/security/network/concepts/privatelink-concepts
- **Know the region's IPs and domains**: control plane, SCC relay, S3/Storage, and the legacy metastore endpoints per region. [doc] https://docs.databricks.com/aws/en/resources/ip-domain-region (switch the cloud selector to Azure to compare)

### 3 Secure cluster connectivity (SCC / "No Public IP") [doc]
- **All new workspaces are created with SCC by default.** Classic compute plane resources have **no public IP addresses**, and the customer VPC has **no open inbound ports**.
- Clusters reach the control plane through a secure tunnel over **HTTPS (port 443)** to the **SCC relay**. The relay keeps web app and REST API traffic separate from cluster-management traffic.
- Serverless compute doesn't use the SCC relay, and its resources also have no public IPs.
- Because SCC removes public IPs, classic clusters need an egress path: a NAT gateway, or a firewall/NVA through UDRs.
- On Azure, the inbound NSG rules for ports **22** and **5557** from the `AzureDatabricks` tag exist **only if SCC is disabled**.
— https://docs.databricks.com/aws/en/security/network/classic/secure-cluster-connectivity

### 4 AWS — customer-managed VPC sizing and rules [doc]
Source: https://docs.databricks.com/aws/en/security/network/classic/customer-managed-vpc

**Subnets**
- Each workspace subnet must be **between /17 and /26**. The VPC netmask itself isn't limited.
- Two /26 subnets need a VPC of /25 or larger.
- Each workspace needs **at least 2 subnets, each in a different AZ**. You can pick only **one workspace subnet per AZ** in a network configuration.
- Subnets must be **private**.
- If the VPC has secondary CIDRs, the workspace subnets must come from the same VPC CIDR block.

**IP addressing**
- Databricks uses **2 IPs per node**: one for management traffic and one for Spark.
- So **instances per subnet = half of the available IPs**. Example: a /26 has 64 − 5 = 59 usable IPs, which supports about 29 nodes.

**Egress and DNS**
- Egress goes through a **NAT gateway + Internet Gateway** or an equivalent appliance. The NAT gateway sits in its own subnet that routes `0.0.0.0/0` to the IGW. Workspace subnets route `0.0.0.0/0` to the NAT.
- The VPC must have **DNS hostnames and DNS resolution enabled**.

**Security groups** (1 to 5 per workspace)
- **Ingress**: all TCP and all UDP from the same security group.
- **Egress**: all TCP/UDP to the same security group, plus TCP to `0.0.0.0/0` on:

| Port | Purpose |
|---|---|
| 443 | Databricks infrastructure, cloud data sources, library repos |
| 3306 | Legacy Hive metastore |
| 53 | DNS, if you use custom DNS |
| 6666 | SCC, PrivateLink only |
| 2443 | FIPS, compliance security profile only |
| 5432 | Classic compute to Lakebase |
| 8443, 8445 | Control-plane API calls |
| 8444 | Unity Catalog logging and lineage streaming |
| 8446–8451 | Reserved |

**Network ACLs**
- NACLs must not deny required traffic.
- Egress: allow everything to the VPC CIDR, plus TCP to `0.0.0.0/0` on 443, 3306, 5432, 6666 (PrivateLink only), 8443, 8444, and 8445.
- Ingress: allow everything from `0.0.0.0/0`.
- Put the Databricks rules at the **lowest rule numbers**.

**Sharing**
- Multiple workspaces can share a VPC. Databricks recommends **unique subnets and security groups per workspace**, though subnets *can* be shared on AWS.
- A **network configuration object can't be reused** across workspaces.
- The node firewall drops traffic coming from other clusters or workspaces in the same VPC.

**Regional endpoints**
- **S3**: a **gateway** endpoint. Cross-region buckets still need the global `s3.amazonaws.com`.
- **STS**: an **interface** endpoint.
- **Kinesis**: an **interface** endpoint, except in us-west-1.
- **RDS**: no VPC endpoint exists. It's needed only for the legacy Hive metastore, not Unity Catalog.

**Egress firewall allowlist**
- Web app/REST API, SCC relay, control-plane infrastructure, `s3.amazonaws.com:443`, `sts.amazonaws.com:443`, regional STS and Kinesis, and regional RDS (legacy HMS only).
- Prefer domain names over IPs.

### 5 Azure — VNet injection and sizing [doc]
Sources: https://learn.microsoft.com/en-us/azure/databricks/security/network/classic/vnet-inject and …/classic/network-sizing

**VNet and subnets**
- The VNet must be in the **same region and same subscription** as the workspace. Its CIDR must be **/16 to /24**.
- There are **2 dedicated subnets**: the **container** (also called "private") subnet and the **host** (also called "public") subnet. Each should be **/26 or larger**. They can be as small as /28, but that isn't recommended. Matching sizes are recommended.
- Subnets **can't be shared across workspaces**, and no other Azure resources can go in them. (This is a key contrast with AWS.)
- Subnet CIDRs **can't be changed after deployment**. To get more room, update the workspace network config or ask the account team to expand the range.
- Both subnets are **delegated to `Microsoft.Databricks/workspaces`**, and their NSG rules are provisioned automatically.
- **Permission needed**: the Network Contributor role, or a custom role with `subnets/join/action` and `subnets/write`.

**Sizing**
- Each node uses **one IP in each subnet** (host + container). **Max nodes = IPs in a subnet − 5** (Azure reserves 5).

| VNet | Max subnet | Max nodes |
|---|---|---|
| /16 | /17 | 32,763 |
| /20 | /21 | 2,043 |
| /24 | /25 | 123 |

**Egress**
- A **NAT gateway** on both subnets is recommended for **stable egress IPs**.
- **After March 31, 2026, new Azure VNets have no default outbound internet access**, so new workspaces need an explicit outbound method such as a NAT Gateway. Existing workspaces are unaffected.

**Workspace NSG rules** (managed — don't modify)

| Direction | Destination | Port(s) |
|---|---|---|
| Inbound | VirtualNetwork | any |
| Inbound | from `AzureDatabricks` | 22, 5557 — **only if SCC is disabled** |
| Outbound | `AzureDatabricks` tag | 443, 3306, 8443–8451 |
| Outbound | `Storage` | 443 |
| Outbound | VirtualNetwork | any |
| Outbound | `EventHub` | 9093 |
| Outbound | `Sql` | 3306 |

- Port meanings: 443 infra/data/libraries; 3306 metastore; **8443** compute-plane-to-control-plane API; **8444** UC logging and lineage; 8445–8451 reserved.
- If you restrict outbound traffic, also open **111 and 2049** for some library installs.
- Use a unique NSG per workspace. Add Deny rules on other subnets or peered VNets, in both directions.

**Other facts**
- VNet peering shows as **disabled** for VNet-injected workspaces, as expected. The managed resource group can't be modified.
- Traffic between control-plane public IPs and the compute plane stays on the **Microsoft backbone**.

### 6 GCP — customer-managed VPC [doc]
Source: https://docs.databricks.com/gcp/en/security/network/classic/customer-managed-vpc
- The subnet range must be **/29 to /9**, in the workspace region.
- Without PSC, the VPC needs egress. **Cloud NAT** is the suggested option, since compute VMs have no public IPs.
- Firewall: an ingress rule `db-<subnet>-ingress` allowing all protocols from the subnet's primary CIDR, at priority 1000.
- **Shared VPC**: the host project owns the VPC. The service project holds compute (GCE VMs) and the 2 GCS buckets (system data and DBFS root). The operating principal needs roles in both projects.
- Multiple workspaces can share a VPC. The VPC **can't be changed after creation**. Requires the **Premium** plan.

### 7 Private Link / Private Service Connect — all variants

**AWS back-end ("classic compute plane") PrivateLink** [doc] https://docs.databricks.com/aws/en/security/network/classic/privatelink
- It uses two VPC interface endpoints in the workspace VPC: a **workspace (REST API) endpoint** and an **SCC relay endpoint**.
- **Requirements**: Enterprise tier, **customer-managed VPC**, SCC, and a region that supports PrivateLink.
- Turn on "Enable private DNS name" on the classic endpoints. Allow TCP 443 from the workspace SG to the STS/Kinesis endpoints. Allow 2443 for FIPS under the compliance security profile.
- Port **6666** (SCC over PrivateLink) must be in the SG egress rules.
- One **private access settings (PAS)** object can serve multiple workspaces in the same region.
- Check it works by running `nslookup <workspace-url>` from a notebook. It should return the endpoint's private IP.

**AWS front-end ("inbound") PrivateLink** [doc] https://docs.databricks.com/aws/en/security/network/front-end/front-end-private-connect
- An interface endpoint in a **transit VPC**, usually separate from the compute VPC, to the regional "General Access (including REST API)" service on **TCP 443**. The endpoint must be **registered** in the account console.
- **PAS public access** options: "Block public network access" (the default) or "Governed by your Databricks ingress policies".
- **PAS private access level**: **Account** (any VPC endpoint registered in the account) or **Endpoint** (an explicit list of endpoints).
- DNS: the workspace URL must resolve through a `privatelink` CNAME, for example `sydney.privatelink.cloud.databricks.com`. If `privatelink` is missing, the PAS isn't attached.
- **SSO**: unified login redirects to `accounts.cloud.databricks.com`. Users without internet access need a private hosted zone with an A record pointing to a General Access endpoint IP. This is Beta.
- On-prem users reach the endpoint over **Direct Connect or VPN**.
- Classic workspaces need a customer-managed VPC. **Serverless-only workspaces don't.**
- Traffic is allowed only if **both PAS and context-based ingress** allow it. Ingress defaults to all registered private endpoints, up to the first 200. Dry-run denials are logged to `system.access.inbound_network`.

**Azure Private Link** [doc] https://learn.microsoft.com/en-us/azure/databricks/security/network/concepts/privatelink-concepts

Private endpoint sub-resources:
- **`databricks_ui_api`**: the workspace endpoint. It's used for both front-end and back-end REST traffic.
- **`browser_authentication`**: needed for browser SSO callbacks from Entra ID over private networking.
  - **Only one per region per private DNS zone.** Best practice is a dedicated "private web auth workspace" per production region, with public access disabled. If that workspace is deleted, web login breaks for every workspace in the region.
- **`general_access`** (Beta): covers workspaces and account resources, custom URLs, and can be shared across regions.
- **`service_direct`** (Public Preview): for performance-intensive services such as Zerobus Ingest and Lakebase Autoscaling.

Choosing a pattern:

| Pattern | Prereqs | Public access | NSG rules setting | Endpoints |
|---|---|---|---|---|
| Front-end only | Premium, VNet injection, SCC | enabled | **AllRules** | front-end + browser auth |
| Back-end only | Premium, VNet injection, SCC | enabled | **NoAzureDatabricksRules** | back-end `databricks_ui_api` |
| Serverless only | Premium | no change | N/A | NCC endpoints |
| Full isolation | Premium, VNet injection, SCC | **disabled** | NoAzureDatabricksRules | all of the above |

Note that Azure needs **Premium**, while AWS and GCP Private Link need **Enterprise**. That's a good quiz contrast.

VNets and subnets:
- **Transit VNet** (hub): inbound endpoints and the browser-auth workspace.
- **Workspace VNet**: the workspace and the classic private endpoint.
- Suggested sizes: transit private-endpoint subnet **/26–/25**, browser-auth workspace subnets **/28 or /27**, classic private-endpoint subnet **/27**.

Other details:
- An NSG on the private-endpoint subnet must allow inbound **443, 6666, 3306, 8443–8451**.
- Even with inbound Private Link, the UI loads static assets from **public CDN domains**, which must be allowed.
- Back-end Private Link can be set up on its own, without front-end or serverless.

**GCP Private Service Connect** [doc] https://docs.databricks.com/gcp/en/security/network/classic/private-service-connect
- PSC comes in **inbound** and **classic compute plane** forms. Each can be used alone or both together.
- **Workspace endpoint**: its service attachment name ends in `plproxy-psc-endpoint-all-ports`. It's used for both inbound and classic traffic.
- **SCC relay endpoint**: its service attachment name ends in `ngrok-psc-endpoint`. It's used for classic traffic only.
- Requirements: **Enterprise** plan and a **customer-managed VPC** (PSC isn't possible with a Databricks-managed VPC). All components must be in the same region.
- Limits: up to **10 PSC endpoints of each type per region**, and 20 total per host project.
- DNS records: the workspace domain and its `dp-` prefixed variant point to the workspace endpoint IP. The relay is `tunnel.<region>.gcp.databricks.com`. There's an intermediate name, `<region>.psc.gcp.databricks.com`.
- Enabling PSC privatizes the traffic paths but **doesn't by itself block public access**. That comes from the PAS.

### 8 Serverless networking: NCC, private endpoints, egress control [doc]

**NCC (Network Connectivity Configuration)**
- An NCC is **account-level and regional**, created by an account admin. It manages private endpoint rules and attaches to one or more workspaces in the region. Every rule applies to all attached workspaces.
- **Azure limits**: up to **20 NCCs per region per account**, **100 private endpoints per region** (shared across NCCs), and **up to 50 workspaces per NCC**. — privatelink-concepts page above.
- Serverless reaches customer resources through S3 gateway endpoints, private IPs, or public IPs.
- If you firewall your resources, also allow the classic compute networks.
- The legacy "stable IP list" from the Public Preview has been **decommissioned**; migrate to the outbound-IPs method, or serverless may hit **403 Forbidden**.
- Private endpoints are billed **per hour plus per GB**.
- Serverless traffic to customer resources and cross-region egress incur networking charges. Keep workspaces co-located with their data.
— https://docs.databricks.com/aws/en/security/network/serverless-network-security/

**Serverless egress control (network policies)** — https://docs.databricks.com/aws/en/security/network/serverless-network-security/network-policies
- Requires the **Enterprise tier**. A network policy is an **account-level object**. One policy can attach to many workspaces, but **each workspace has only one policy**.
- **Full Access**: unrestricted outbound access. It still doesn't allow cross-workspace access.
- **Restricted Access**: outbound is limited to UC external locations plus the FQDNs and storage buckets listed in the policy. Cross-workspace access needs the source's egress rule *and* the destination's ingress rule.
- **Allowed implicitly**: UC external locations, the workspace's own APIs, the workspace's root S3 bucket, and essential system tables and sample datasets (read-only).
- Under Restricted Access, **direct storage access from user code in UDFs or notebooks is blocked**; go through UC or DBFS mounts. Private-endpoint traffic must also be allowed by UC or the policy.
- **Covered products**: notebooks, workflows, SQL warehouses, Lakeflow pipelines, Model Serving, Data Quality Monitoring, Lakehouse//RT (Beta), Apps (limited), and MCP services (`system.ai.*`, which need the MCP server's DNS names).
- Model Serving calls to external models need the provider's FQDNs in the policy.
- **Dry-run mode** lets you evaluate a policy before enforcing it.

### 9 Front-end access controls [doc]

**IP access lists** — https://docs.databricks.com/aws/en/security/network/front-end/ip-access-list
- Requires the **Enterprise tier on AWS**. By default, connections from any IP are allowed.
- **Allow lists and block lists. Block is evaluated first.** If any allow list exists, the IP must match one.
- **Account console** lists are set through the UI or API. **Workspace** lists are set through the REST API.
- Limit: **1000 IP/CIDR values** across all lists combined in the account console. Changes take **a few minutes** to apply.
- They apply **only to public-internet traffic**. **PrivateLink private IPs can't be blocked by IP access lists**: use the PAS "Endpoint" level, context-based ingress, or AWS Network Firewall instead.

**Context-based ingress control** — https://docs.databricks.com/aws/en/security/network/front-end/context-based-ingress
- An account-level policy that combines **who** (identity), **from where** (public IPs, partner platforms, registered private endpoints, or cross-workspace in Beta), and **what** (Workspace UI, API, Apps runtime, Lakebase runtime; Account UI/API).
- It's combined with IP access lists using **logical AND**, so IP lists can narrow access but never widen it. Databricks recommends it as the single policy engine.
- Requires **Enterprise**. It's **GA**, except account-level policies, which are Beta; their denials log `workspace_id = 0`.

### 10 Worked scenarios (for quiz authoring)
1. "Customer wants no public internet path at all on Azure." Expected answer: VNet injection + SCC, back-end + front-end Private Link, transit VNet, browser_auth workspace, `publicNetworkAccess` disabled, `NoAzureDatabricksRules`, NAT or firewall with UDRs for egress, NCC for serverless, and serverless egress policy set to Restricted.
2. "Size a VNet for 500 concurrent nodes on Azure." You need at least 505 IPs per subnet, so /23 subnets (512 − 5 = 507). That means two /23s, which fit in a /22 VNet; recommend more headroom.
3. "Size an AWS subnet for 500 nodes." That's 1,000 IPs + 5, so a /22 (1,024 − 5 = 1,019 → 509 nodes) in each of 2 AZs.
4. "Cluster can't reach on-prem Oracle." Check UDRs or Transit Gateway routes, non-overlapping CIDRs, NSG/SG egress on 1521, DNS forwarding, and the on-prem firewall allowlisting the NAT or subnet IPs.
5. "SQL warehouse (serverless) can't reach the storage firewall." Use NCC private endpoints, or allow the serverless outbound IPs. Note the legacy stable-IP list is gone (the 403 symptom). Also check the egress policy.
6. "Library install fails behind Zscaler." Install the corporate CA through an init script, configure the proxy, and open 443 to PyPI/Maven (plus 111/2049 on Azure if restricted).
