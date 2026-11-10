/** Suggested skills for the typeahead. Freelancers can also add skills that aren't listed. */
export const SKILLS: string[] = [
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

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export const MAX_SKILLS = 25;

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
