import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Redis-First Architecture',
    Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
    description: (
      <>
        Built on Redis for blazing-fast event processing, real-time pub/sub,
        and distributed state management. Achieve sub-millisecond latency with
        atomic Lua scripts and efficient data structures.
      </>
    ),
  },
  {
    title: 'Event-Driven Design',
    Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
    description: (
      <>
        Decorator pattern automatically generates HTTP, MCP, and WebSocket
        interfaces from a single handler. Follow the <code>domain.action</code> naming
        convention for clear, maintainable event flows.
      </>
    ),
  },
  {
    title: 'AI-Native Platform',
    Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
    description: (
      <>
        Seamless MCP (Model Context Protocol) integration for Claude and other AI models.
        Built-in swarm intelligence for task decomposition, distributed processing,
        and intelligent synthesis.
      </>
    ),
  },
];

function Feature({title, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
