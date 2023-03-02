import { Construct } from "constructs";
import {
  Repository,
  TeamRepository,
  BranchProtection,
  IssueLabel,
  RepositoryWebhook,
  GithubProvider,
  DataGithubRepository,
  RepositoryFile,
} from "@cdktf/provider-github";
import { SecretFromVariable } from "./secrets";

export interface ITeam {
  id: string;
}

export interface RepositoryConfig {
  description?: string;
  topics?: string[];
  team: ITeam;
  protectMain?: boolean;
  protectMainChecks?: string[];
  webhookUrl: string;
  provider: GithubProvider;
}

export class RepositorySetup extends Construct {
  constructor(
    scope: Construct,
    name: string,
    config: Pick<
      RepositoryConfig,
      "team" | "webhookUrl" | "provider" | "protectMain" | "protectMainChecks"
    > & {
      repository: Repository | DataGithubRepository;
    }
  ) {
    super(scope, name);

    const {
      protectMain = false,
      protectMainChecks = ["build"],
      provider,
      repository,
      team,
      webhookUrl,
    } = config;

    new IssueLabel(this, `automerge-label`, {
      color: "5DC8DB",
      name: "automerge",
      repository: repository.name,
      provider,
    });

    if (protectMain) {
      new BranchProtection(this, "main-protection", {
        pattern: "main",
        repositoryId: repository.name,
        enforceAdmins: true,
        allowsDeletions: false,
        allowsForcePushes: false,
        requiredStatusChecks: [
          {
            strict: true,
            contexts: protectMainChecks,
          },
        ],
        provider,
      });
    }

    new TeamRepository(this, "managing-team", {
      repository: repository.name,
      teamId: team.id,
      permission: "admin",
      provider,
    });

    // Slack integration so we can be notified about new PRs and Issues
    new RepositoryWebhook(this, "slack-webhook", {
      repository: repository.name,

      configuration: {
        url: webhookUrl,
        contentType: "json",
      },

      // We don't need to notify about PRs since they are auto-created
      events: ["issues"],
      provider,
    });

    // Only for go provider repositories
    new RepositoryFile(this, "codeowners", {
      repository: repository.name,
      count: `\${regex("-go", ${repository.name}) == "-go" ? 1 : 0}` as any,
      file: ".github/CODEOWNERS",
      content: [
        "# These owners will be the default owners for everything in ",
        "# the repo. Unless a later match takes precedence, ",
        "# they will be requested for review when someone opens a ",
        "# pull request.",
        "*       @cdktf/tf-cdk-team",
      ].join("\n"),
    });
  }
}

export class GithubRepository extends Construct {
  public readonly resource: Repository;
  private readonly provider: GithubProvider;
  public static defaultTopics = [
    "cdktf",
    "terraform",
    "terraform-cdk",
    "cdk",
    "provider",
    "pre-built-provider",
  ];

  constructor(scope: Construct, name: string, config: RepositoryConfig) {
    super(scope, name);

    const {
      topics = GithubRepository.defaultTopics,
      description = "Repository management for prebuilt cdktf providers via cdktf",
      provider,
    } = config;
    this.provider = provider;

    this.resource = new Repository(this, "repo", {
      name,
      description,
      visibility: "public",
      homepageUrl: "https://cdk.tf",
      hasIssues: true,
      hasWiki: false,
      autoInit: true,
      hasProjects: false,
      deleteBranchOnMerge: true,
      topics,
      provider,
    });

    new RepositorySetup(this, "repository-setup", {
      ...config,
      repository: this.resource,
    });
  }

  addSecret(name: string) {
    const variable = new SecretFromVariable(this, name);
    variable.for(this.resource, this.provider);
  }
}

export class GithubRepositoryFromExistingRepository extends Construct {
  public readonly resource: DataGithubRepository;

  constructor(
    scope: Construct,
    name: string,
    config: Pick<RepositoryConfig, "team" | "webhookUrl" | "provider"> & {
      repositoryName: string;
    }
  ) {
    super(scope, name);

    this.resource = new DataGithubRepository(this, "repo", {
      name: config.repositoryName,
      provider: config.provider,
    });

    new RepositorySetup(this, "repository-setup", {
      ...config,
      repository: this.resource,
    });
  }
}
