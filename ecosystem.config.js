module.exports = {
  apps: [
    {
      name: "archon-ops",
      script: "npm",
      args: "run start",
      env: {
        PORT: 3200,
        NODE_OPTIONS: "--max-old-space-size=4096",
      },
    },
  ],
};
