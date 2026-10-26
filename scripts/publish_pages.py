"""Publish the committed dist/ snapshot to GitHub Pages without custom Actions.

The deployment branch contains only the website. Its commits advance normally;
existing history is retained, and concurrent updates are never force-pushed.
"""
import argparse
import subprocess


def git(*args, capture=True):
    result = subprocess.run(['git', *args], check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    remotes = git('remote').splitlines()
    parser.add_argument('--remote', default='github' if 'github' in remotes else 'origin')
    args = parser.parse_args()
    git('remote', 'get-url', args.remote)
    if git('status', '--porcelain', '--', 'dist'):
        parser.error('Commit the changes under dist/ before publishing.')
    for filename in ['index.html', '.nojekyll']:
        git('cat-file', '-e', 'HEAD:dist/' + filename)
    source = git('rev-parse', 'HEAD')
    tree = git('rev-parse', 'HEAD:dist')
    branch = 'refs/heads/gh-pages'
    parents = []
    if git('ls-remote', '--heads', args.remote, branch):
        git('fetch', '--no-tags', args.remote, branch, capture=False)
        parent = git('rev-parse', 'FETCH_HEAD')
        if git('rev-parse', parent + '^{tree}') == tree:
            print('The gh-pages branch already contains this website snapshot.')
            return
        parents = ['-p', parent]
    commit = git('commit-tree', tree, *parents, '-m', 'Publish website from source ' + source)
    git('push', args.remote, commit + ':' + branch, capture=False)
    print('Published committed dist/ snapshot:', commit)
    print('GitHub Pages will deploy the gh-pages branch automatically.')


if __name__ == '__main__':
    main()
