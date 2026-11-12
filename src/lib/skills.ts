/** Suggested skills for the typeahead. Freelancers can also add skills that aren't listed. */
const BASE_SKILLS: string[] = [
  // Languages
  "JavaScript", "TypeScript", "Python", "Java", "C", "C++", "C#", "Go", "Rust", "Ruby", "PHP", "Swift", "Kotlin", "Dart", "Scala",
  "R", "MATLAB", "SQL", "Bash", "PowerShell", "Lua", "Elixir", "Haskell", "Solidity", "HTML", "CSS", "Sass", "Objective-C", "Perl",
  // Frontend
  "React", "Next.js", "Vue.js", "Nuxt", "Angular", "Svelte", "SvelteKit", "Redux", "Zustand", "Tailwind CSS", "Bootstrap", "Material UI",
  "Chakra UI", "Styled Components", "Vite", "Webpack", "jQuery", "Three.js", "D3.js", "Framer Motion", "Storybook", "Responsive Design",
  "Web Accessibility", "Progressive Web Apps", "WebAssembly", "Web Components", "SEO",
  // Backend
  "Node.js", "Express", "NestJS", "Fastify", "Django", "Flask", "FastAPI", "Spring Boot", "ASP.NET", ".NET", "Laravel", "Ruby on Rails",
  "GraphQL", "REST APIs", "gRPC", "WebSockets", "Microservices", "Serverless", "API Design", "OAuth", "JWT", "Authentication",
  // Mobile
  "React Native", "Flutter", "iOS Development", "Android Development", "SwiftUI", "Jetpack Compose", "Expo", "Ionic", "Mobile App Development",
  // Data & databases
  "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Supabase", "Firebase", "DynamoDB", "Elasticsearch", "Cassandra", "Prisma",
  "Database Design", "Data Modeling", "Snowflake", "BigQuery", "ETL", "Apache Spark", "Apache Kafka", "Airflow", "dbt",
  // Cloud & DevOps
  "AWS", "Google Cloud", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible", "CI/CD", "GitHub Actions", "GitLab CI", "Jenkins",
  "Linux", "Nginx", "Cloudflare", "Vercel", "Netlify", "Monitoring", "Prometheus", "Grafana", "Infrastructure as Code", "DevOps", "SRE",
  // AI / data science
  "Machine Learning", "Deep Learning", "Data Science", "Data Analysis", "Data Visualization", "Natural Language Processing",
  "Computer Vision", "TensorFlow", "PyTorch", "scikit-learn", "Pandas", "NumPy", "OpenAI API", "LLMs", "Prompt Engineering",
  "LangChain", "RAG", "Generative AI", "Jupyter", "Power BI", "Tableau", "Excel", "Statistics", "A/B Testing",
  // Testing & quality
  "Unit Testing", "Test-Driven Development", "Jest", "Vitest", "Cypress", "Playwright", "Selenium", "Pytest", "End-to-End Testing",
  "Code Review", "QA Automation", "Performance Optimization", "Debugging",
  // Security
  "Cybersecurity", "Penetration Testing", "Application Security", "Cryptography", "Network Security", "Security Auditing",
  // Payments & integrations
  "PayPal Integration", "Stripe", "Payment Systems", "Webhooks", "Third-party Integrations", "Zapier", "Shopify", "WordPress", "WooCommerce",
  "Salesforce", "HubSpot", "Twilio", "SendGrid",
  // Web3 & other
  "Blockchain", "Smart Contracts", "Ethereum", "Web3.js", "Game Development", "Unity", "Unreal Engine", "Godot", "Embedded Systems",
  "Arduino", "Raspberry Pi", "IoT", "Robotics", "AR/VR", "Electron", "Chrome Extensions", "CLI Tools", "Web Scraping", "Automation",
  // Design & product
  "UI Design", "UX Design", "UX Research", "Figma", "Prototyping", "Wireframing", "Design Systems", "Adobe XD", "Photoshop", "Illustrator",
  "Branding", "Motion Design", "Product Management", "Technical Writing", "Documentation", "Agile", "Scrum", "Project Management", "Jira",
  "Git", "GitHub", "Open Source",
];

// More well-known skills (added to the list above; duplicates are ignored automatically).
const MORE_SKILLS: string[] = [
  // Professional & soft skills
  "Communication", "Leadership", "Teamwork", "Problem Solving", "Critical Thinking", "Time Management", "Mentoring", "Public Speaking",
  "Negotiation", "Stakeholder Management", "Client Management", "Technical Leadership", "Strategic Planning", "Business Analysis",
  "Requirements Gathering", "Product Strategy", "Roadmapping", "User Stories", "Kanban", "Lean", "Six Sigma", "Risk Management",
  "Budgeting", "Customer Support", "Presentation Skills", "Research", "Analytical Skills", "Creativity", "Adaptability", "Collaboration",
  "Cross-functional Collaboration", "Remote Collaboration", "Decision Making", "Conflict Resolution", "Attention to Detail",
  // Engineering practices
  "System Design", "Software Architecture", "Domain-Driven Design", "Design Patterns", "Clean Code", "Refactoring", "Pair Programming",
  "Object-Oriented Programming", "Functional Programming", "Concurrency", "Algorithms", "Data Structures", "Event-Driven Architecture",
  "Monorepos", "Legacy Code Modernization", "Technical Debt Management", "Code Quality", "API Documentation",
  // Frontend & JS ecosystem
  "TanStack Query", "Remix", "Astro", "Gatsby", "Solid.js", "Alpine.js", "HTMX", "Ember.js", "Preact", "Lit", "Radix UI", "shadcn/ui",
  "Ant Design", "Less", "PostCSS", "Babel", "ESLint", "Prettier", "npm", "pnpm", "Yarn", "Turborepo", "Nx", "RxJS", "Socket.IO", "tRPC",
  "Deno", "Bun", "Koa", "Handlebars", "Pug", "Markdown",
  // Backend, frameworks & languages
  "Gin", "Echo", "Actix", "Ktor", "Quarkus", "Micronaut", "Hibernate", "JPA", "Maven", "Gradle", "Symfony", "CodeIgniter", "Sinatra",
  "Phoenix", "Play Framework", "Akka", "Vapor", "Blazor", "Entity Framework", "LINQ", "SignalR", "Clojure", "F#", "Groovy", "Julia",
  "Assembly", "COBOL", "Fortran", "Visual Basic", "VBA", "Delphi", "Erlang", "OCaml", "Zig", "TypeScript Generics",
  // Mobile
  "Xamarin", ".NET MAUI", "Kotlin Multiplatform", "Capacitor", "NativeScript", "Core Data", "Room", "Combine", "Coroutines", "App Store Optimization",
  // Data & databases
  "CockroachDB", "TimescaleDB", "InfluxDB", "Neo4j", "ClickHouse", "Redshift", "Databricks", "Hadoop", "Hive", "Trino", "Apache Flink",
  "Dagster", "Prefect", "Looker", "Metabase", "Superset", "Qlik", "MariaDB", "Oracle Database", "SQL Server", "PL/SQL", "T-SQL", "CouchDB",
  "Memcached", "Pinecone", "Vector Databases", "Data Engineering", "Data Warehousing", "Data Governance", "Data Cleaning", "Data Pipelines",
  "Google Analytics", "Mixpanel", "Amplitude", "Segment", "Hotjar", "Google Tag Manager",
  // Cloud, DevOps & observability
  "AWS Lambda", "Amazon S3", "Amazon EC2", "Amazon RDS", "Amazon ECS", "Amazon EKS", "CloudFormation", "AWS CDK", "Azure DevOps", "Azure Functions",
  "Cloud Run", "Heroku", "DigitalOcean", "Fly.io", "Render", "Pulumi", "Packer", "Vagrant", "Puppet", "Chef", "Helm", "Argo CD", "Istio",
  "Consul", "Vault", "HAProxy", "Apache HTTP Server", "Tomcat", "RabbitMQ", "NATS", "Amazon SQS", "ELK Stack", "Kibana", "Datadog",
  "New Relic", "Splunk", "Sentry", "OpenTelemetry", "Bash Scripting", "Shell Scripting", "Windows Server", "Active Directory", "Networking",
  "TCP/IP", "DNS", "Load Balancing", "Site Reliability", "Cloud Architecture", "Cost Optimization", "Disaster Recovery", "Release Management",
  // AI & machine learning
  "Hugging Face", "Transformers", "Keras", "XGBoost", "LightGBM", "OpenCV", "spaCy", "NLTK", "Reinforcement Learning", "MLOps", "MLflow",
  "Kubeflow", "Feature Engineering", "Time Series Analysis", "Recommender Systems", "Embeddings", "Fine-tuning", "LLM Evaluation",
  "Speech Recognition", "Image Processing", "Predictive Modeling", "Statistical Modeling", "Bayesian Statistics", "Data Mining", "Chatbots",
  "Conversational AI", "AI Agents", "Anthropic API", "Claude API", "Model Deployment",
  // Security & compliance
  "OWASP", "Threat Modeling", "Incident Response", "SIEM", "Vulnerability Assessment", "Secure Coding", "SOC 2", "GDPR", "HIPAA", "PCI DSS",
  "ISO 27001", "Compliance", "Identity and Access Management", "Single Sign-On", "OpenID Connect", "SAML", "Encryption",
  // Testing & tools
  "Postman", "Swagger", "OpenAPI", "Load Testing", "JMeter", "k6", "Mocha", "JUnit", "Testing Library", "Behavior-Driven Development",
  "Regression Testing", "Manual Testing", "Accessibility Testing", "VS Code", "IntelliJ IDEA", "Vim", "Linux Command Line", "Bitbucket",
  "Confluence", "Trello", "Asana", "Notion", "Slack", "Linear",
  // Design, media & content
  "Sketch", "InVision", "Canva", "Adobe Creative Suite", "After Effects", "Premiere Pro", "Final Cut Pro", "Blender", "3D Modeling",
  "Video Editing", "Animation", "Illustration", "Typography", "Color Theory", "Graphic Design", "Logo Design", "Interaction Design",
  "Information Architecture", "User Testing", "Usability Testing", "Design Thinking", "Copywriting", "Content Writing", "Content Strategy",
  "Editing", "Proofreading", "Translation", "Transcription", "Voice Over", "Podcast Production", "Photography", "Storytelling",
  // Marketing, ecommerce & business tools
  "Digital Marketing", "Social Media Marketing", "Email Marketing", "Growth Marketing", "Search Engine Marketing", "Google Ads", "Meta Ads",
  "Influencer Marketing", "Marketing Automation", "Mailchimp", "CRM", "Lead Generation", "Sales", "E-commerce", "Magento", "BigCommerce",
  "Wix", "Squarespace", "Webflow", "Contentful", "Strapi", "Sanity", "Headless CMS", "Drupal", "Joomla", "Odoo", "SAP", "ServiceNow",
  "Power Automate", "Power Apps", "Airtable", "Microsoft 365", "Google Workspace", "Google Sheets", "Google Apps Script", "QuickBooks",
  "Accounting", "Bookkeeping", "Financial Modeling", "Financial Analysis", "Market Research", "Competitive Analysis", "Virtual Assistance",
  "Data Entry", "Customer Success", "Technical Support", "IT Support", "Teaching", "Tutoring", "Curriculum Design",
];

const key = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
const seen = new Set<string>();
/** The full suggestion list: the base list plus the extra skills, without duplicates. */
export const SKILLS: string[] = [...BASE_SKILLS, ...MORE_SKILLS].filter((x) => {
  const k = key(x);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The most skills one person can add to their profile. (Not the size of the suggestion list.) */
export const MAX_SKILLS = 50;

/** Ranks catalog skills for a query: exact, then prefix, then word-prefix, then substring. */
export function suggestSkills(query: string, selected: string[], limit = 8, source: string[] = SKILLS): string[] {
  const q = norm(query);
  const taken = new Set(selected.map(norm));
  const pool = source.filter((s) => !taken.has(norm(s)));
  if (!q) return pool.slice(0, limit);
  const scored: { s: string; score: number }[] = [];
  for (const s of pool) {
    const n = norm(s);
    let score = -1;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (n.split(/[\s./-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (n.includes(q)) score = 3;
    if (score >= 0) scored.push({ s, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.s.length - b.s.length || a.s.localeCompare(b.s)).slice(0, limit).map((x) => x.s);
}

/** Returns the catalog's spelling when the text matches a known skill, otherwise a cleaned-up version of the text. */
export function canonicalSkill(text: string): string {
  const n = norm(text);
  return SKILLS.find((s) => norm(s) === n) ?? text.trim().replace(/\s+/g, " ");
}

export const hasSkill = (list: string[], skill: string) => list.some((s) => norm(s) === norm(skill));
