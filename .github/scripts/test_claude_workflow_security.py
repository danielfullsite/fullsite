"""Regresión estática para el gatillo de Claude en un repositorio público.

No ejecuta Actions ni llama a GitHub. Comprueba el contrato que evita que un
comentario público seleccione una rama ajena o haga un merge directo.
"""

from pathlib import Path


WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "claude.yml"


def test_workflow_requires_a_trusted_trigger_and_own_repo_pr() -> None:
    source = WORKFLOW.read_text(encoding="utf-8")

    assert "author_association" in source
    assert '"OWNER","MEMBER","COLLABORATOR"' in source
    assert "github.event.pull_request.head.repo.full_name == github.repository" in source


def test_issue_branch_is_scoped_and_merge_waits_for_checks() -> None:
    source = WORKFLOW.read_text(encoding="utf-8")
    executable = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("#"))

    assert 'case "$ISSUE_NUMBER" in' in source
    assert '"claude/issue-${ISSUE_NUMBER}-*"' in source
    assert "sort -k3 -r" not in executable
    assert 'gh pr merge "$BRANCH" --repo "$REPO" --auto --squash' in source
    assert "merge --squash" not in source


if __name__ == "__main__":
    tests = (
        test_workflow_requires_a_trusted_trigger_and_own_repo_pr,
        test_issue_branch_is_scoped_and_merge_waits_for_checks,
    )
    for test in tests:
        test()
        print(f"ok {test.__name__}")
