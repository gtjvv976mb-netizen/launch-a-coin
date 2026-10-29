import { Link } from "@tanstack/react-router";
import { Icon } from "../../mintdex/ui";

/**
 * The mainnet launch's help control: a link to the wallet steps on /how#wallet (the words rule: the steps that used to
 * open in a dialog here live on that page). `compact`: the phone header's 44px help icon, the same look as the shell's
 * help button on every other route.
 */
export function LiveLaunchGuide({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <Link to="/how" hash="wallet" aria-label="How it works" title="How it works" className="mdx-btn mdx-btn--icon mdx-btn--ghost">
      <Icon name="help" />
    </Link>
  ) : (
    <Link to="/how" hash="wallet" className="mdx-link mdx-hit">
      How it works
    </Link>
  );
}
